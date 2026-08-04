import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
    buildClipboardTimeoutMessage,
    buildCopySuccessMessage,
    copyLinux,
    copyMac,
    copyWindows,
    copyWsl,
    createZipArchive,
    extractPathsFromArgs,
    MissingLinuxClipboardToolsError,
    parseCopyFilePathResult,
    ProcessTimeoutError,
    pruneNestedPaths,
    runCommandExists
} from './core';

type InvocationSource = 'explorer' | 'editor';
type SaveBeforeCopy = 'prompt' | 'always' | 'never';
type CopyMode = 'files' | 'zip';

const ARCHIVE_RETENTION_MS = 24 * 60 * 60 * 1000;
const LINUX_SETUP_URL = 'https://github.com/mjkimR/direct-file-copy#requirements-linux-only';

interface ExistingTarget {
    path: string;
    stats: fs.Stats;
}

interface ResolvedSelection {
    targetPaths: string[];
    skippedPaths: string[];
}

interface DiagnosticResult {
    report: string;
    ready: boolean;
}

export function activate(context: vscode.ExtensionContext) {
    const diagnosticsOutput = vscode.window.createOutputChannel('Direct File Copy');
    const commands = [
        vscode.commands.registerCommand('copy-file-object.copy', (...args: unknown[]) =>
            executeCopyCommand(context, args, 'files')),
        vscode.commands.registerCommand('copy-file-object.copyAllChanges', (...args: unknown[]) =>
            executeCopyCommand(context, args, 'files', true)),
        vscode.commands.registerCommand('copy-file-object.copyAsZip', (...args: unknown[]) =>
            executeCopyCommand(context, args, 'zip')),
        vscode.commands.registerCommand('copy-file-object.diagnose', () =>
            runDiagnostics(diagnosticsOutput))
    ];

    context.subscriptions.push(diagnosticsOutput, ...commands);
    void cleanupExpiredArchives(context).catch(() => undefined);
}

export function deactivate() { }

async function executeCopyCommand(
    context: vscode.ExtensionContext,
    args: unknown[],
    mode: CopyMode,
    requireMenuSelection = false
): Promise<void> {
    try {
        const remoteName = vscode.env.remoteName;
        if (remoteName && remoteName !== 'wsl') {
            throw new Error(`Direct File Copy is not supported in remote environments (${remoteName}) as it requires local clipboard access. Tip: right-click the file in the Explorer and use "Download..." to save it locally instead.`);
        }

        const selection = await resolveSelection(args, requireMenuSelection);
        if (!selection) {
            return;
        }

        if (mode === 'zip') {
            const archivePath = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Creating ZIP archive…',
                cancellable: false
            }, () => createTemporaryArchive(context, selection.targetPaths));
            await copyPathsToClipboard([archivePath], remoteName);
            notifySuccess(buildCopySuccessMessage([archivePath], selection.skippedPaths));
            return;
        }

        await copyPathsToClipboard(selection.targetPaths, remoteName);
        notifySuccess(buildCopySuccessMessage(selection.targetPaths, selection.skippedPaths));
    } catch (error) {
        await handleCopyError(error);
    }
}

async function resolveSelection(
    args: unknown[],
    requireMenuSelection: boolean
): Promise<ResolvedSelection | undefined> {
    // Explorer/editor menus pass (Uri, Uri[]); SCM menus pass resource states or groups.
    let targetPaths = extractPathsFromArgs(args);
    const invocationSource = getInvocationSource(args);

    if (targetPaths.length === 0 && requireMenuSelection) {
        vscode.window.showWarningMessage('No files were found in this Source Control group.');
        return undefined;
    }

    if (targetPaths.length === 0) {
        if (invocationSource === 'editor') {
            targetPaths = getActiveEditorPath();
        } else {
            targetPaths = await getPathsFromClipboardWorkaround();
        }
    }

    if (targetPaths.length === 0 && invocationSource === 'explorer') {
        vscode.window.showWarningMessage(
            'Could not determine the selected Explorer items. Try right-clicking the selection and choose "Copy as File Object".'
        );
        return undefined;
    }

    if (targetPaths.length === 0 && invocationSource === undefined) {
        targetPaths = getActiveEditorPath();
    }

    // Selecting a folder and something inside it is easy in a tree view; the child is
    // already carried by the folder, so copying both would paste/zip it twice.
    targetPaths = pruneNestedPaths(targetPaths);

    const targetChecks = await Promise.all(targetPaths.map(getExistingTarget));
    const existingTargets = targetChecks.filter((item): item is ExistingTarget => item !== undefined);
    const skippedPaths = targetPaths.filter((_, index) => targetChecks[index] === undefined);
    targetPaths = existingTargets.map(item => item.path);

    if (targetPaths.length === 0) {
        const suffix = skippedPaths.length > 0
            ? ` ${skippedPaths.length} selected item${skippedPaths.length === 1 ? '' : 's'} no longer exist${skippedPaths.length === 1 ? 's' : ''}.`
            : '';
        vscode.window.showWarningMessage(`No files or folders available to copy.${suffix}`);
        return undefined;
    }

    if (!await prepareDirtyDocuments(findDirtyDocuments(existingTargets))) {
        return undefined;
    }
    return { targetPaths, skippedPaths };
}

async function copyPathsToClipboard(paths: string[], remoteName: string | undefined): Promise<void> {
    const platform = process.platform;
    const isWsl = remoteName === 'wsl' ||
        (platform === 'linux' && Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP));

    try {
        if (isWsl) {
            await copyWsl(paths);
        } else if (platform === 'darwin') {
            await copyMac(paths);
        } else if (platform === 'win32') {
            await copyWindows(paths);
        } else if (platform === 'linux') {
            await copyLinux(paths);
        } else {
            throw new Error(`Unsupported platform: ${platform}`);
        }
    } catch (error) {
        if (error instanceof ProcessTimeoutError) {
            throw new Error(buildClipboardTimeoutMessage(paths.length, error.timeoutMs));
        }
        throw error;
    }
}

function notifySuccess(message: string): void {
    const style = vscode.workspace.getConfiguration('directFileCopy').get<string>('notificationStyle', 'statusBar');
    if (style === 'statusBar') {
        vscode.window.setStatusBarMessage(`$(check) ${message}`, 3000);
    } else {
        vscode.window.showInformationMessage(message);
    }
}

function getInvocationSource(args: unknown[]): InvocationSource | undefined {
    const first = args[0];
    if (typeof first !== 'object' || first === null) {
        return undefined;
    }
    const source = (first as Record<string, unknown>).invocationSource;
    return source === 'explorer' || source === 'editor' ? source : undefined;
}

function getActiveEditorPath(): string[] {
    const activeEditor = vscode.window.activeTextEditor;
    return activeEditor?.document.uri.scheme === 'file'
        ? [activeEditor.document.uri.fsPath]
        : [];
}

function findDirtyDocuments(targets: ExistingTarget[]): vscode.TextDocument[] {
    return vscode.workspace.textDocuments.filter(document => {
        if (!document.isDirty || document.uri.scheme !== 'file') {
            return false;
        }
        return targets.some(target => {
            if (samePath(document.uri.fsPath, target.path)) {
                return true;
            }
            return target.stats.isDirectory() && isDescendantPath(document.uri.fsPath, target.path);
        });
    });
}

function samePath(a: string, b: string): boolean {
    const left = path.resolve(a);
    const right = path.resolve(b);
    return process.platform === 'win32'
        ? left.toLowerCase() === right.toLowerCase()
        : left === right;
}

function isDescendantPath(candidate: string, parent: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative !== '' && relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function prepareDirtyDocuments(documents: vscode.TextDocument[]): Promise<boolean> {
    if (documents.length === 0) {
        return true;
    }

    const policy = vscode.workspace.getConfiguration('directFileCopy')
        .get<SaveBeforeCopy>('saveBeforeCopy', 'prompt');
    if (policy === 'never') {
        return true;
    }

    if (policy === 'prompt') {
        const names = documents.slice(0, 3).map(document => path.basename(document.uri.fsPath));
        const summary = documents.length <= 3
            ? names.join(', ')
            : `${names.join(', ')} and ${documents.length - 3} more`;
        const choice = await vscode.window.showWarningMessage(
            `${documents.length} selected file${documents.length === 1 ? ' has' : 's have'} unsaved changes (${summary}).`,
            { modal: true },
            'Save and Copy',
            'Copy Saved Version'
        );
        if (choice === undefined) {
            return false;
        }
        if (choice === 'Copy Saved Version') {
            return true;
        }
    }

    const results = await Promise.all(documents.map(document => document.save()));
    if (results.some(saved => !saved)) {
        throw new Error('One or more selected files could not be saved. Nothing was copied.');
    }
    return true;
}

async function handleCopyError(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof MissingLinuxClipboardToolsError)) {
        vscode.window.showErrorMessage(`Failed to copy file object: ${message}`);
        return;
    }

    const action = await vscode.window.showErrorMessage(
        `Failed to copy file object: ${message}`,
        'View Setup',
        'Copy Install Command'
    );
    if (action === 'View Setup') {
        await vscode.env.openExternal(vscode.Uri.parse(LINUX_SETUP_URL));
    } else if (action === 'Copy Install Command') {
        await chooseAndCopyLinuxInstallCommand();
    }
}

async function chooseAndCopyLinuxInstallCommand(): Promise<void> {
    const choices = [
        {
            label: 'Debian / Ubuntu',
            description: 'APT',
            command: 'sudo apt install wl-clipboard xclip'
        },
        {
            label: 'Fedora / RHEL',
            description: 'DNF',
            command: 'sudo dnf install wl-clipboard xclip'
        },
        {
            label: 'Arch Linux',
            description: 'pacman',
            command: 'sudo pacman -S wl-clipboard xclip'
        }
    ];
    const choice = await vscode.window.showQuickPick(choices, {
        placeHolder: 'Select your Linux distribution'
    });
    if (!choice) {
        return;
    }
    await vscode.env.clipboard.writeText(choice.command);
    vscode.window.showInformationMessage(`Copied install command: ${choice.command}`);
}

async function createTemporaryArchive(
    context: vscode.ExtensionContext,
    sourcePaths: string[]
): Promise<string> {
    await cleanupExpiredArchives(context);
    const archiveRoot = path.join(context.globalStorageUri.fsPath, 'archives');
    const sessionDirectory = path.join(archiveRoot, `${Date.now()}-${randomUUID()}`);
    const archiveName = sourcePaths.length === 1
        ? `${path.basename(sourcePaths[0])}.zip`
        : 'direct-file-copy.zip';
    const archivePath = path.join(sessionDirectory, archiveName);
    await createZipArchive(sourcePaths, archivePath);
    return archivePath;
}

async function cleanupExpiredArchives(context: vscode.ExtensionContext): Promise<void> {
    const archiveRoot = path.join(context.globalStorageUri.fsPath, 'archives');
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(archiveRoot, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return;
        }
        throw error;
    }

    const cutoff = Date.now() - ARCHIVE_RETENTION_MS;
    await Promise.all(entries
        .filter(entry => entry.isDirectory())
        .map(async entry => {
            const directoryPath = path.join(archiveRoot, entry.name);
            const timestamp = Number(entry.name.split('-', 1)[0]);
            if (Number.isFinite(timestamp) && timestamp < cutoff) {
                await fs.promises.rm(directoryPath, { recursive: true, force: true });
            }
        }));
}

async function runDiagnostics(output: vscode.OutputChannel): Promise<void> {
    const result = await buildDiagnosticReport();
    output.clear();
    output.appendLine(result.report);
    output.show(true);

    const action = await vscode.window.showInformationMessage(
        `Direct File Copy diagnostics: ${result.ready ? 'Ready' : 'Needs attention'}.`,
        'Copy Report'
    );
    if (action === 'Copy Report') {
        await vscode.env.clipboard.writeText(result.report);
        vscode.window.setStatusBarMessage('$(check) Copied diagnostics report.', 3000);
    }
}

async function buildDiagnosticReport(): Promise<DiagnosticResult> {
    const lines = [
        'Direct File Copy Diagnostics',
        `Generated: ${new Date().toISOString()}`,
        `VS Code: ${vscode.version}`,
        `Platform: ${process.platform} (${process.arch})`,
        `Remote: ${vscode.env.remoteName ?? 'none'}`
    ];
    const remoteName = vscode.env.remoteName;

    if (remoteName && remoteName !== 'wsl') {
        lines.push(
            'Backend: unavailable',
            `Status: Unsupported remote environment (${remoteName})`,
            'Suggestion: use Explorer > Download… to save the file locally first.'
        );
        return { report: lines.join('\n'), ready: false };
    }

    const isWsl = remoteName === 'wsl' ||
        (process.platform === 'linux' && Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP));
    if (isWsl) {
        const [hasWslPath, hasPowerShell, hasFallbackPowerShell] = await Promise.all([
            runCommandExists('wslpath'),
            runCommandExists('powershell.exe'),
            isExecutable('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
        ]);
        const ready = hasWslPath && (hasPowerShell || hasFallbackPowerShell);
        lines.push(
            'Backend: WSL2 > Windows PowerShell',
            `wslpath: ${hasWslPath ? 'available' : 'missing'}`,
            `Windows PowerShell: ${hasPowerShell || hasFallbackPowerShell ? 'available' : 'missing'}`,
            `Status: ${ready ? 'Ready' : 'Needs attention'}`
        );
        if (!ready) {
            lines.push('Suggestion: confirm WSL2 and Windows interop are enabled in /etc/wsl.conf.');
        }
        return { report: lines.join('\n'), ready };
    }

    if (process.platform === 'darwin') {
        const ready = await runCommandExists('osascript');
        lines.push(
            'Backend: macOS NSPasteboard via osascript',
            `osascript: ${ready ? 'available' : 'missing'}`,
            `Status: ${ready ? 'Ready' : 'Needs attention'}`
        );
        return { report: lines.join('\n'), ready };
    }

    if (process.platform === 'win32') {
        const ready = await runCommandExists('powershell.exe');
        lines.push(
            'Backend: Windows FileDropList via PowerShell',
            `PowerShell: ${ready ? 'available' : 'missing'}`,
            `Status: ${ready ? 'Ready' : 'Needs attention'}`
        );
        return { report: lines.join('\n'), ready };
    }

    if (process.platform === 'linux') {
        const [hasWlCopy, hasXclip] = await Promise.all([
            runCommandExists('wl-copy'),
            runCommandExists('xclip')
        ]);
        const hasWayland = Boolean(process.env.WAYLAND_DISPLAY);
        const hasX11 = Boolean(process.env.DISPLAY);
        const ready = (hasWayland && hasWlCopy) || (hasX11 && hasXclip);
        lines.push(
            `Session: ${hasWayland ? 'Wayland' : hasX11 ? 'X11' : 'no display detected'}`,
            `wl-copy: ${hasWlCopy ? 'available' : 'missing'}`,
            `xclip: ${hasXclip ? 'available' : 'missing'}`,
            `Status: ${ready ? 'Ready' : 'Needs attention'}`
        );
        if (!hasWlCopy && !hasXclip) {
            lines.push('Suggestion: install wl-clipboard or xclip.');
        } else if (!hasWayland && !hasX11) {
            lines.push('Suggestion: run VS Code in a graphical Wayland or X11 session.');
        } else if (!ready) {
            lines.push(`Suggestion: install ${hasWayland ? 'wl-clipboard' : 'xclip'} for the current display session.`);
        }
        if ((process.env.XDG_CURRENT_DESKTOP ?? '').toLowerCase().includes('kde')) {
            lines.push('Warning: KDE Dolphin requires clipboard formats that are not currently supported.');
        }
        return { report: lines.join('\n'), ready };
    }

    lines.push('Backend: unavailable', `Status: Unsupported platform (${process.platform})`);
    return { report: lines.join('\n'), ready: false };
}

async function isExecutable(filePath: string): Promise<boolean> {
    try {
        await fs.promises.access(filePath, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

async function getPathsFromClipboardWorkaround(): Promise<string[]> {
    const originalText = await vscode.env.clipboard.readText();
    try {
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

        return currentText === token ? [] : parseCopyFilePathResult(currentText);
    } finally {
        // Always restore the original clipboard text: if the copy later fails the user's
        // clipboard must survive, and on success the native copy overwrites it anyway.
        await vscode.env.clipboard.writeText(originalText);
    }
}

async function getExistingTarget(p: string): Promise<ExistingTarget | undefined> {
    try {
        return { path: p, stats: await fs.promises.lstat(p) };
    } catch {
        return undefined;
    }
}
