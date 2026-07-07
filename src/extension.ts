import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    copyLinux,
    copyMac,
    copyWindows,
    copyWsl,
    extractPathsFromArgs,
    parseCopyFilePathResult
} from './core';

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('copy-file-object.copy', async (...args: any[]) => {
        try {
            // 1. Check remote context first — before the clipboard workaround runs,
            // so an unsupported session never touches the user's clipboard.
            const remoteName = vscode.env.remoteName;
            if (remoteName && remoteName !== 'wsl') {
                throw new Error(`Direct File Copy is not supported in remote environments (${remoteName}) as it requires local clipboard access. Tip: right-click the file in the Explorer and use "Download..." to save it locally instead.`);
            }

            // 2. Gather paths
            // Explorer/editor menus pass (Uri, Uri[]); the SCM view passes SourceControlResourceState objects.
            let targetPaths = extractPathsFromArgs(args);

            if (targetPaths.length === 0) {
                // Triggered by shortcut (alt+c) or command palette
                // Use clipboard workaround to get paths of selected files in explorer
                targetPaths = await getPathsFromClipboardWorkaround();
            }

            if (targetPaths.length === 0) {
                // Fallback to active editor path if clipboard workaround returned nothing
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor && activeEditor.document.uri.scheme === 'file') {
                    targetPaths = [activeEditor.document.uri.fsPath];
                }
            }

            // Drop paths that no longer exist on disk (e.g. deleted files selected in the SCM view)
            targetPaths = targetPaths.filter(p => fs.existsSync(p));

            if (targetPaths.length === 0) {
                vscode.window.showWarningMessage('No files or folders selected to copy.');
                return;
            }

            // 3. Pick the platform backend
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

            // 4. Success notification
            const fileCount = targetPaths.length;
            const message = fileCount > 1
                ? `Copied ${fileCount} items as file objects.`
                : `Copied ${path.basename(targetPaths[0])} as file object.`;
            notifySuccess(message);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to copy file object: ${error.message}`);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }

function notifySuccess(message: string): void {
    const style = vscode.workspace.getConfiguration('directFileCopy').get<string>('notificationStyle', 'popup');
    if (style === 'statusBar') {
        vscode.window.setStatusBarMessage(`$(check) ${message}`, 3000);
    } else {
        vscode.window.showInformationMessage(message);
    }
}

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

    const paths = currentText === token ? [] : parseCopyFilePathResult(currentText);

    // Always restore the original clipboard text: if the copy later fails the user's
    // clipboard must survive, and on success the native copy overwrites it anyway.
    await vscode.env.clipboard.writeText(originalText);
    return paths;
}
