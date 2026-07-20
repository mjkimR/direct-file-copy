// Pure, vscode-independent logic. Everything here is unit/integration testable
// with plain Node (see src/test/) — keep vscode API usage in extension.ts.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ZipFile } from 'yazl';

export const PROCESS_TIMEOUT_MS = 10000;

export class MissingLinuxClipboardToolsError extends Error {
    constructor() {
        super('Linux clipboard tools are not installed. Please install wl-clipboard or xclip.');
        this.name = 'MissingLinuxClipboardToolsError';
    }
}

export interface RunProcessOptions {
    stdin?: string;
    timeoutMs?: number;
    launchErrorMessage?: (err: Error) => string;
    stdio?: 'pipe' | 'ignore' | Array<'pipe' | 'ignore' | 'inherit' | number | null | undefined>;
}

export function runProcess(cmd: string, args: string[], opts: RunProcessOptions = {}): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? PROCESS_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: opts.stdio });
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

        if (child.stdout) {
            child.stdout.on('data', d => stdout += d);
        }
        if (child.stderr) {
            child.stderr.on('data', d => stderr += d);
        }

        child.on('error', err => finish(() => reject(new Error(
            opts.launchErrorMessage ? opts.launchErrorMessage(err) : `Failed to launch ${cmd}: ${err.message}`
        ))));

        if (child.stdin) {
            child.stdin.on('error', () => { /* ignore EPIPE if the process failed to start */ });
            if (opts.stdin !== undefined) {
                child.stdin.write(opts.stdin);
            }
            child.stdin.end();
        }

        child.on('close', code => finish(() => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
            }
        }));
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

function isUriLike(item: unknown): item is UriLike {
    if (typeof item === 'object' && item !== null) {
        const candidate = item as Record<string, unknown>;
        return typeof candidate.scheme === 'string' && typeof candidate.fsPath === 'string';
    }
    return false;
}

// Command arguments vary by menu source: explorer/editor menus pass (Uri, Uri[]),
// the SCM view passes SourceControlResourceState objects ({ resourceUri: Uri, ... }).
export function extractPathsFromArgs(args: unknown[]): string[] {
    const paths: string[] = [];
    const seen = new Set<string>();

    const visit = (item: unknown) => {
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
        } else if (typeof item === 'object') {
            const obj = item as Record<string, unknown>;
            if (Array.isArray(obj.resourceStates)) {
                visit(obj.resourceStates);
            }
            if (isUriLike(obj.resourceUri)) {
                uri = obj.resourceUri;
            }
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

function summarizeBasenames(paths: string[]): string {
    const names = paths.map(p => path.basename(p));
    if (names.length === 1) {
        return names[0];
    }
    if (names.length === 2) {
        return `${names[0]} and ${names[1]}`;
    }
    if (names.length === 3) {
        return `${names[0]}, ${names[1]}, and ${names[2]}`;
    }
    return `${names[0]}, ${names[1]}, and ${names.length - 2} more`;
}

export function buildCopySuccessMessage(copiedPaths: string[], skippedPaths: string[]): string {
    const copied = summarizeBasenames(copiedPaths);
    const copyMessage = copiedPaths.length === 1
        ? `Copied ${copied} as a file object.`
        : `Copied ${copied} as file objects.`;

    if (skippedPaths.length === 0) {
        return copyMessage;
    }

    const skipped = summarizeBasenames(skippedPaths);
    const skipMessage = skippedPaths.length === 1
        ? `Skipped ${skipped} because it no longer exists.`
        : `Skipped ${skipped} because they no longer exist.`;
    return `${copyMessage} ${skipMessage}`;
}

export function buildUniqueArchiveEntryNames(paths: string[]): string[] {
    const used = new Set<string>();
    return paths.map(sourcePath => {
        const basename = path.basename(sourcePath);
        const extension = path.extname(basename);
        const stem = extension ? basename.slice(0, -extension.length) : basename;
        let candidate = basename;
        let suffix = 2;
        while (used.has(candidate.toLowerCase())) {
            candidate = `${stem} (${suffix})${extension}`;
            suffix++;
        }
        used.add(candidate.toLowerCase());
        return candidate;
    });
}

export async function createZipArchive(sourcePaths: string[], destinationPath: string): Promise<void> {
    const entryNames = buildUniqueArchiveEntryNames(sourcePaths);
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });

    await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(destinationPath, { flags: 'wx' });
        const zip = new ZipFile();
        let settled = false;

        const fail = (error: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            zip.outputStream.unpipe(output);
            output.destroy();
            void fs.promises.unlink(destinationPath).catch(() => undefined);
            reject(error);
        };

        output.on('close', () => {
            if (!settled) {
                settled = true;
                resolve();
            }
        });
        output.on('error', fail);
        zip.on('error', fail);
        zip.outputStream.pipe(output);

        void (async () => {
            try {
                for (let index = 0; index < sourcePaths.length; index++) {
                    await addPathToZip(zip, sourcePaths[index], entryNames[index]);
                }
                zip.end();
            } catch (error) {
                fail(error instanceof Error ? error : new Error(String(error)));
            }
        })();
    });
}

async function addPathToZip(zip: ZipFile, sourcePath: string, entryName: string): Promise<void> {
    const stats = await fs.promises.lstat(sourcePath);
    const options = { mtime: stats.mtime, mode: stats.mode };
    if (stats.isSymbolicLink()) {
        zip.addBuffer(Buffer.from(await fs.promises.readlink(sourcePath)), entryName, {
            ...options,
            compress: false
        });
        return;
    }
    if (!stats.isDirectory()) {
        zip.addFile(sourcePath, entryName, { ...options, compressionLevel: 9 });
        return;
    }

    zip.addEmptyDirectory(entryName, options);
    const children = await fs.promises.readdir(sourcePath);
    children.sort((a, b) => a.localeCompare(b));
    for (const child of children) {
        await addPathToZip(
            zip,
            path.join(sourcePath, child),
            path.posix.join(entryName, child)
        );
    }
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

export function chooseLinuxClipboardTool(
    hasWlCopy: boolean,
    hasXclip: boolean,
    display: { wayland?: string; x11?: string } = {
        wayland: process.env.WAYLAND_DISPLAY,
        x11: process.env.DISPLAY
    }
): 'wl-copy' | 'xclip' | undefined {
    const preferWlCopy = Boolean(display.wayland) || !display.x11;
    if (hasWlCopy && (preferWlCopy || !hasXclip)) {
        return 'wl-copy';
    }
    if (hasXclip) {
        return 'xclip';
    }
    return hasWlCopy ? 'wl-copy' : undefined;
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

    const [hasWlCopy, hasXclip] = await Promise.all([
        runCommandExists('wl-copy'),
        runCommandExists('xclip')
    ]);
    const tool = chooseLinuxClipboardTool(hasWlCopy, hasXclip);

    if (tool === 'wl-copy') {
        await runProcess('wl-copy', ['--type', 'x-special/gnome-copied-files'], {
            stdin: gnomeContent,
            stdio: ['pipe', 'ignore', 'ignore']
        });
        return;
    }

    if (tool === 'xclip') {
        await runProcess('xclip', ['-selection', 'clipboard', '-t', 'x-special/gnome-copied-files'], {
            stdin: gnomeContent,
            stdio: ['pipe', 'ignore', 'ignore']
        });
        return;
    }

    throw new MissingLinuxClipboardToolsError();
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
