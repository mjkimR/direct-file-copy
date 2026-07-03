import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('copy-file-object.copy', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        try {
            let targetPaths: string[] = [];

            // 1. Gather paths
            if (uris && uris.length > 0) {
                // Triggered from explorer context menu (multiple or single selection)
                targetPaths = uris.map(u => u.fsPath);
            } else if (uri) {
                // Triggered from explorer context menu (single selection fallback)
                targetPaths = [uri.fsPath];
            } else {
                // Triggered by shortcut (alt+c) or command palette
                // Use clipboard workaround to get paths of selected files in explorer
                targetPaths = await getPathsFromClipboardWorkaround();

                // Fallback to active editor path if clipboard workaround returned nothing
                if (targetPaths.length === 0) {
                    const activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor && activeEditor.document.uri.scheme === 'file') {
                        targetPaths = [activeEditor.document.uri.fsPath];
                    }
                }
            }

            if (targetPaths.length === 0) {
                vscode.window.showWarningMessage('No files or folders selected to copy.');
                return;
            }

            // 2. Check remote context and platform
            const remoteName = vscode.env.remoteName;
            if (remoteName && remoteName !== 'wsl') {
                throw new Error(`Direct File Copy is not supported in remote environments (${remoteName}) as it requires local clipboard access.`);
            }

            const platform = process.platform;
            const isWsl = remoteName === 'wsl' || (platform === 'linux' && (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP));

            if (isWsl) {
                await copyWsl(targetPaths);
            } else if (platform === 'darwin') {
                await copyMac(targetPaths);
            } else if (platform === 'win32') {
                await copyWindows(targetPaths);
            } else if (platform === 'linux') {
                await copyLinux(targetPaths);
            } else {
                throw new Error(`Unsupported platform: ${platform}`);
            }

            // 3. Success notification
            const fileCount = targetPaths.length;
            const displayNames = fileCount > 1
                ? `${fileCount} items`
                : path.basename(targetPaths[0]);

            vscode.window.showInformationMessage(`Copied ${displayNames} as file object(s).`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to copy file object: ${error.message}`);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }

async function getPathsFromClipboardWorkaround(): Promise<string[]> {
    const originalText = await vscode.env.clipboard.readText();
    const token = `__COPY_FILE_PATH_TOKEN_${Date.now()}__`;
    await vscode.env.clipboard.writeText(token);

    // Execute the built-in command that copies file path of active/selected items
    await vscode.commands.executeCommand('copyFilePath');

    // Poll for clipboard change (up to 300ms)
    const startTime = Date.now();
    let currentText = token;
    while (Date.now() - startTime < 300) {
        currentText = await vscode.env.clipboard.readText();
        if (currentText !== token) {
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 30));
    }

    if (currentText !== token && currentText.trim() !== '') {
        // Return paths
        return currentText
            .split(/\r?\n/)
            .map(p => p.trim())
            .filter(p => p.length > 0);
    }

    // Restore original clipboard text if workaround timed out or failed
    if (currentText === token) {
        await vscode.env.clipboard.writeText(originalText);
    }

    return [];
}

function runAppleScript(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn('osascript', []);
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', data => stdout += data);
        child.stderr.on('data', data => stderr += data);

        child.on('close', code => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr.trim() || `osascript exited with code ${code}`));
            }
        });

        child.stdin.write(script);
        child.stdin.end();
    });
}

async function copyMac(paths: string[]): Promise<void> {
    const scriptLines: string[] = [
        'use AppleScript version "2.4"',
        'use framework "Foundation"',
        'use framework "AppKit"',
        'use scripting additions',
        'set filePaths to {}'
    ];
    for (const p of paths) {
        const normalized = p.normalize('NFC');
        const escaped = normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
        `pb's writeObjects:fileURLs`
    );
    const script = scriptLines.join('\n');
    await runAppleScript(script);
}

function runPowerShell(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', '-']);
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', data => stdout += data);
        child.stderr.on('data', data => stderr += data);

        child.on('close', code => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr.trim() || `powershell exited with code ${code}`));
            }
        });

        child.stdin.write(script);
        child.stdin.end();
    });
}

async function copyWindows(paths: string[]): Promise<void> {
    const scriptLines: string[] = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$files = New-Object System.Collections.Specialized.StringCollection'
    ];
    for (const p of paths) {
        const escaped = p.replace(/'/g, "''");
        scriptLines.push(`[void]$files.Add('${escaped}')`);
    }
    scriptLines.push('[System.Windows.Forms.Clipboard]::SetFileDropList($files)');
    const script = scriptLines.join('\r\n');
    await runPowerShell(script);
}

function runCommandExists(cmd: string): Promise<boolean> {
    return new Promise((resolve) => {
        const check = process.platform === 'win32' ? 'where' : 'which';
        const child = spawn(check, [cmd]);
        child.on('close', code => {
            resolve(code === 0);
        });
    });
}

function pipeToCommand(cmd: string, args: string[], data: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args);
        let stderr = '';

        child.stderr.on('data', d => stderr += d);
        child.on('close', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim()}`));
            }
        });

        child.stdin.write(data);
        child.stdin.end();
    });
}

async function copyLinux(paths: string[]): Promise<void> {
    const gnomeContent = 'copy\n' + paths.map(p => vscode.Uri.file(p).toString()).join('\n');

    const hasWlCopy = await runCommandExists('wl-copy');
    if (hasWlCopy) {
        await pipeToCommand('wl-copy', ['--type', 'x-special/gnome-copied-files'], gnomeContent);
        return;
    }

    const hasXclip = await runCommandExists('xclip');
    if (hasXclip) {
        await pipeToCommand('xclip', ['-selection', 'clipboard', '-t', 'x-special/gnome-copied-files'], gnomeContent);
        return;
    }

    throw new Error('Linux clipboard tools are not installed. Please install wl-clipboard or xclip.');
}

async function convertWslPath(wslPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn('wslpath', ['-w', wslPath]);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => stdout += d);
        child.stderr.on('data', d => stderr += d);
        child.on('close', code => {
            if (code === 0) {
                resolve(stdout.trim());
            } else {
                reject(new Error(`wslpath failed: ${stderr.trim() || `exit code ${code}`}`));
            }
        });
    });
}

async function getPowerShellPathForWsl(): Promise<string> {
    const hasPs = await runCommandExists('powershell.exe');
    if (hasPs) {
        return 'powershell.exe';
    }
    return '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
}

async function copyWsl(paths: string[]): Promise<void> {
    // Convert Linux paths in WSL to Windows paths
    const winPaths = await Promise.all(paths.map(p => convertWslPath(p)));

    // Generate powershell script to set clipboard System.Windows.Forms.Clipboard
    const scriptLines: string[] = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$files = New-Object System.Collections.Specialized.StringCollection'
    ];
    for (const p of winPaths) {
        const escaped = p.replace(/'/g, "''");
        scriptLines.push(`[void]$files.Add('${escaped}')`);
    }
    scriptLines.push('[System.Windows.Forms.Clipboard]::SetFileDropList($files)');
    const script = scriptLines.join('\r\n');

    // Run powershell.exe inside WSL
    const psCmd = await getPowerShellPathForWsl();
    await new Promise<void>((resolve, reject) => {
        const child = spawn(psCmd, ['-NoProfile', '-NonInteractive', '-STA', '-Command', '-']);
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', data => stdout += data);
        child.stderr.on('data', data => stderr += data);

        child.on('close', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(stderr.trim() || `powershell exited with code ${code}`));
            }
        });

        child.stdin.write(script);
        child.stdin.end();
    });
}
