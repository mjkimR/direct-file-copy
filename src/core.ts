// Pure, vscode-independent logic. Everything here is unit/integration testable
// with plain Node (see src/test/) — keep vscode API usage in extension.ts.
import { spawn } from 'child_process';
import * as path from 'path';
import { pathToFileURL } from 'url';

export const PROCESS_TIMEOUT_MS = 10000;

export interface RunProcessOptions {
    stdin?: string;
    timeoutMs?: number;
    launchErrorMessage?: (err: Error) => string;
}

export function runProcess(cmd: string, args: string[], opts: RunProcessOptions = {}): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? PROCESS_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args);
        let stdout = '';
        let stderr = '';
        let settled = false;

        const finish = (fn: () => void) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                fn();
            }
        };

        // Kill processes that launch but never exit (e.g. clipboard locked by another app)
        const timer = setTimeout(() => {
            child.kill();
            finish(() => reject(new Error(`${cmd} timed out after ${timeoutMs / 1000}s.`)));
        }, timeoutMs);

        child.stdout.on('data', d => stdout += d);
        child.stderr.on('data', d => stderr += d);

        child.on('error', err => finish(() => reject(new Error(
            opts.launchErrorMessage ? opts.launchErrorMessage(err) : `Failed to launch ${cmd}: ${err.message}`
        ))));
        child.stdin.on('error', () => { /* ignore EPIPE if the process failed to start */ });

        child.on('close', code => finish(() => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
            }
        }));

        if (opts.stdin !== undefined) {
            child.stdin.write(opts.stdin);
        }
        child.stdin.end();
    });
}

export async function runCommandExists(cmd: string): Promise<boolean> {
    const check = process.platform === 'win32' ? 'where' : 'which';
    try {
        await runProcess(check, [cmd]);
        return true;
    } catch {
        return false;
    }
}

interface UriLike {
    scheme: string;
    fsPath: string;
}

function isUriLike(item: any): item is UriLike {
    return !!item && typeof item.scheme === 'string' && typeof item.fsPath === 'string';
}

// Command arguments vary by menu source: explorer/editor menus pass (Uri, Uri[]),
// the SCM view passes SourceControlResourceState objects ({ resourceUri: Uri, ... }).
export function extractPathsFromArgs(args: any[]): string[] {
    const paths: string[] = [];
    const seen = new Set<string>();

    const visit = (item: any) => {
        if (!item) {
            return;
        }
        if (Array.isArray(item)) {
            item.forEach(visit);
            return;
        }
        let uri: UriLike | undefined;
        if (isUriLike(item)) {
            uri = item;
        } else if (isUriLike(item.resourceUri)) {
            uri = item.resourceUri;
        }
        if (uri && uri.scheme === 'file' && !seen.has(uri.fsPath)) {
            seen.add(uri.fsPath);
            paths.push(uri.fsPath);
        }
    };

    args.forEach(visit);
    return paths;
}

// Parse the text that VS Code's built-in copyFilePath command put on the clipboard.
// Only absolute paths are usable (copyFilePath yields e.g. "Untitled-1" for unsaved documents).
export function parseCopyFilePathResult(text: string): string[] {
    return text
        .split(/\r?\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0 && path.isAbsolute(p));
}

export function buildMacPasteboardScript(paths: string[]): string {
    const scriptLines: string[] = [
        'use AppleScript version "2.4"',
        'use framework "Foundation"',
        'use framework "AppKit"',
        'use scripting additions',
        'set filePaths to {}'
    ];
    for (const p of paths) {
        const normalized = p.normalize('NFC');
        // Escape newlines too: APFS allows them in filenames, and a literal line
        // break inside an AppleScript string is a syntax error.
        const escaped = normalized
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
        scriptLines.push(`copy "${escaped}" to end of filePaths`);
    }
    scriptLines.push(
        `set fileURLs to current application's NSMutableArray's alloc()'s init()`,
        `repeat with aPath in filePaths`,
        `    set aURL to current application's NSURL's fileURLWithPath:aPath`,
        `    (fileURLs's addObject:aURL)`,
        `end repeat`,
        `set pb to current application's NSPasteboard's generalPasteboard()`,
        `pb's clearContents()`,
        `set writeOk to pb's writeObjects:fileURLs`,
        `if (writeOk as boolean) is false then error "Failed to write file objects to the pasteboard."`,
        // Query the pasteboard again before exiting: the round-trip pushes the write
        // through to the pasteboard server. Exiting immediately after writeObjects
        // makes it silently drop most items (empirically: 3 URLs collapse to 1).
        `pb's pasteboardItems()'s |count|()`
    );
    return scriptLines.join('\n');
}

export function buildFileDropListScript(paths: string[]): string {
    const scriptLines: string[] = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$files = New-Object System.Collections.Specialized.StringCollection'
    ];
    for (const p of paths) {
        const escaped = p.replace(/'/g, "''");
        scriptLines.push(`[void]$files.Add('${escaped}')`);
    }
    scriptLines.push('[System.Windows.Forms.Clipboard]::SetFileDropList($files)');
    return scriptLines.join('\r\n');
}

export function buildGnomeClipboardContent(paths: string[]): string {
    return 'copy\n' + paths.map(p => pathToFileURL(p).toString()).join('\n');
}

export const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-STA', '-Command', '-'];

async function macPasteboardItemCount(): Promise<number> {
    const script = [
        'use framework "AppKit"',
        `set pb to current application's NSPasteboard's generalPasteboard()`,
        `return (pb's pasteboardItems()'s |count|()) as integer`
    ].join('\n');
    const out = await runProcess('osascript', [], { stdin: script });
    return parseInt(out.trim(), 10);
}

export async function copyMac(paths: string[]): Promise<void> {
    // The pasteboard server occasionally drops trailing items when the writing process
    // exits right after writeObjects (checking the count in the same process reports
    // success even when items were lost). Verify from a separate process and retry.
    const script = buildMacPasteboardScript(paths);
    let lastCount = -1;
    for (let attempt = 0; attempt < 3; attempt++) {
        await runProcess('osascript', [], { stdin: script });
        lastCount = await macPasteboardItemCount();
        if (lastCount === paths.length) {
            return;
        }
    }
    throw new Error(`Pasteboard write incomplete: expected ${paths.length} items, found ${lastCount}.`);
}

export async function copyWindows(paths: string[]): Promise<void> {
    await runProcess('powershell.exe', POWERSHELL_ARGS, { stdin: buildFileDropListScript(paths) });
}

export async function copyLinux(paths: string[]): Promise<void> {
    const gnomeContent = buildGnomeClipboardContent(paths);

    const hasWlCopy = await runCommandExists('wl-copy');
    if (hasWlCopy) {
        await runProcess('wl-copy', ['--type', 'x-special/gnome-copied-files'], { stdin: gnomeContent });
        return;
    }

    const hasXclip = await runCommandExists('xclip');
    if (hasXclip) {
        await runProcess('xclip', ['-selection', 'clipboard', '-t', 'x-special/gnome-copied-files'], { stdin: gnomeContent });
        return;
    }

    throw new Error('Linux clipboard tools are not installed. Please install wl-clipboard or xclip.');
}

export async function convertWslPath(wslPath: string): Promise<string> {
    // wslpath -w picks the right drive/UNC prefix (\\wsl$ vs \\wsl.localhost) and distro name for us
    const stdout = await runProcess('wslpath', ['-w', wslPath], {
        launchErrorMessage: err => `Failed to launch wslpath: ${err.message}. Direct File Copy requires WSL2.`
    });
    return stdout.trim();
}

async function getPowerShellPathForWsl(): Promise<string> {
    const hasPs = await runCommandExists('powershell.exe');
    if (hasPs) {
        return 'powershell.exe';
    }
    return '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
}

export async function copyWsl(paths: string[]): Promise<void> {
    // Convert Linux paths in WSL to Windows paths
    const winPaths = await Promise.all(paths.map(p => convertWslPath(p)));

    // Run powershell.exe on the Windows host to set its clipboard
    const psCmd = await getPowerShellPathForWsl();
    await runProcess(psCmd, POWERSHELL_ARGS, {
        stdin: buildFileDropListScript(winPaths),
        launchErrorMessage: err =>
            `Could not launch Windows PowerShell from WSL (${err.message}). ` +
            `Direct File Copy requires WSL interop to be enabled — ensure you are on WSL2 and that ` +
            `[interop] enabled and appendWindowsPath are not disabled in /etc/wsl.conf.`
    });
}
