import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'node:url';
import {
    buildCopySuccessMessage,
    buildFileDropListScript,
    buildGnomeClipboardContent,
    buildMacPasteboardScript,
    buildClipboardTimeoutMessage,
    buildUniqueArchiveEntryNames,
    chooseLinuxClipboardTool,
    createZipArchive,
    extractPathsFromArgs,
    macSettleSeconds,
    parseCopyFilePathResult,
    PROCESS_TIMEOUT_MS,
    ProcessTimeoutError,
    pruneNestedPaths,
    runCommandExists,
    runProcess
} from '../../core';

// Platform-appropriate absolute sample paths for tests
const abs = (...segments: string[]) => path.resolve(path.sep, ...segments);

function fakeUri(fsPath: string, scheme = 'file') {
    return { scheme, fsPath };
}

// --- extractPathsFromArgs ---

test('extractPathsFromArgs: explorer-style (uri, uris[]) args, deduped', () => {
    const a = fakeUri(abs('proj', 'a.txt'));
    const b = fakeUri(abs('proj', 'b.txt'));
    const result = extractPathsFromArgs([a, [a, b]]);
    assert.deepEqual(result, [a.fsPath, b.fsPath]);
});

test('extractPathsFromArgs: SCM resource states via resourceUri', () => {
    const state = { resourceUri: fakeUri(abs('proj', 'changed.ts')), decorations: {} };
    assert.deepEqual(extractPathsFromArgs([state, [state]]), [state.resourceUri.fsPath]);
});

test('extractPathsFromArgs: SCM resource groups via resourceStates', () => {
    const a = { resourceUri: fakeUri(abs('proj', 'a.ts')) };
    const b = { resourceUri: fakeUri(abs('proj', 'b.ts')) };
    const group = { id: 'workingTree', resourceStates: [a, b] };
    assert.deepEqual(extractPathsFromArgs([group]), [a.resourceUri.fsPath, b.resourceUri.fsPath]);
});

test('extractPathsFromArgs: non-file schemes are skipped', () => {
    const remote = fakeUri('/remote/x.txt', 'vscode-remote');
    const untitled = fakeUri('Untitled-1', 'untitled');
    const local = fakeUri(abs('x.txt'));
    assert.deepEqual(extractPathsFromArgs([remote, untitled, local]), [local.fsPath]);
});

test('extractPathsFromArgs: ignores null/undefined/strings/junk', () => {
    assert.deepEqual(extractPathsFromArgs([null, undefined, 'a string', 42, {}, []]), []);
});

// --- parseCopyFilePathResult ---

test('parseCopyFilePathResult: splits LF and CRLF, trims entries', () => {
    const p1 = abs('a.txt');
    const p2 = abs('b.txt');
    assert.deepEqual(parseCopyFilePathResult(`${p1}\r\n ${p2} \n`), [p1, p2]);
});

test('parseCopyFilePathResult: rejects relative/untitled entries', () => {
    const good = abs('real.txt');
    assert.deepEqual(parseCopyFilePathResult(`Untitled-1\n${good}\nsome/relative/path`), [good]);
});

test('parseCopyFilePathResult: empty and whitespace-only input', () => {
    assert.deepEqual(parseCopyFilePathResult(''), []);
    assert.deepEqual(parseCopyFilePathResult('  \n \r\n'), []);
});

// --- buildCopySuccessMessage ---

test('buildCopySuccessMessage: names a single copied item', () => {
    assert.equal(
        buildCopySuccessMessage([abs('project', 'a.ts')], []),
        'Copied a.ts as a file object.'
    );
});

test('buildCopySuccessMessage: summarizes several copied items', () => {
    assert.equal(
        buildCopySuccessMessage([
            abs('project', 'a.ts'),
            abs('project', 'b.ts'),
            abs('project', 'c.ts'),
            abs('project', 'd.ts')
        ], []),
        'Copied a.ts, b.ts, and 2 more as file objects.'
    );
});

test('buildCopySuccessMessage: reports skipped missing items by name', () => {
    assert.equal(
        buildCopySuccessMessage(
            [abs('project', 'kept.ts')],
            [abs('project', 'deleted.ts'), abs('project', 'removed.ts')]
        ),
        'Copied kept.ts as a file object. Skipped deleted.ts and removed.ts because they no longer exist.'
    );
});

// --- ZIP archives ---

test('buildUniqueArchiveEntryNames: disambiguates duplicate basenames', () => {
    assert.deepEqual(
        buildUniqueArchiveEntryNames([
            abs('one', 'index.ts'),
            abs('two', 'index.ts'),
            abs('three', 'INDEX.ts')
        ]),
        ['index.ts', 'index (2).ts', 'INDEX (3).ts']
    );
});

test('createZipArchive: includes files, directories, and duplicate basenames', async (t) => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'direct-file-copy-zip-test-'));
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
    const firstDir = path.join(tempRoot, 'first');
    const secondDir = path.join(tempRoot, 'second');
    const nestedDir = path.join(tempRoot, 'folder');
    await Promise.all([
        fs.promises.mkdir(firstDir),
        fs.promises.mkdir(secondDir),
        fs.promises.mkdir(nestedDir)
    ]);
    await Promise.all([
        fs.promises.writeFile(path.join(firstDir, 'same.txt'), 'first'),
        fs.promises.writeFile(path.join(secondDir, 'same.txt'), 'second'),
        fs.promises.writeFile(path.join(nestedDir, 'nested.txt'), 'nested')
    ]);
    const destination = path.join(tempRoot, 'result.zip');

    await createZipArchive([
        path.join(firstDir, 'same.txt'),
        path.join(secondDir, 'same.txt'),
        nestedDir
    ], destination);

    const archiveBytes = await fs.promises.readFile(destination);
    assert.ok(archiveBytes.length > 0);
    assert.equal(archiveBytes.subarray(0, 2).toString(), 'PK');
});

// --- buildFileDropListScript ---

test('buildFileDropListScript: one Add per path, wrapped in SetFileDropList', () => {
    const script = buildFileDropListScript(['C:\\a.txt', 'C:\\dir\\b.txt']);
    const lines = script.split('\r\n');
    assert.equal(lines[0], 'Add-Type -AssemblyName System.Windows.Forms');
    assert.equal(lines.filter(l => l.startsWith('[void]$files.Add(')).length, 2);
    assert.equal(lines[lines.length - 1], '[System.Windows.Forms.Clipboard]::SetFileDropList($files)');
});

test('buildFileDropListScript: escapes single quotes (PowerShell literal strings)', () => {
    const script = buildFileDropListScript(["C:\\O'Brien\\file.txt"]);
    assert.ok(script.includes("[void]$files.Add('C:\\O''Brien\\file.txt')"));
});

// --- pruneNestedPaths ---

test('pruneNestedPaths: drops files and folders covered by a selected ancestor', () => {
    const dir = abs('proj', 'dir');
    const result = pruneNestedPaths([
        dir,
        path.join(dir, 'a.txt'),
        path.join(dir, 'sub'),
        path.join(dir, 'sub', 'b.txt')
    ]);
    assert.deepEqual(result, [dir]);
});

test('pruneNestedPaths: keeps siblings and unrelated paths, preserving order', () => {
    const dir = abs('proj', 'dir');
    const sibling = abs('proj', 'other.txt');
    const deep = abs('proj', 'deep', 'nested', 'c.txt');
    const result = pruneNestedPaths([sibling, dir, path.join(dir, 'a.txt'), deep]);
    assert.deepEqual(result, [sibling, dir, deep]);
});

test('pruneNestedPaths: does not treat a name prefix as an ancestor', () => {
    const dir = abs('proj', 'dir');
    const lookalike = abs('proj', 'dirty.txt');
    assert.deepEqual(pruneNestedPaths([dir, lookalike]), [dir, lookalike]);
});

test('pruneNestedPaths: keeps a child when only its sibling folder is selected', () => {
    const a = abs('proj', 'a');
    const bChild = path.join(abs('proj', 'b'), 'x.txt');
    assert.deepEqual(pruneNestedPaths([a, bChild]), [a, bChild]);
});

test('pruneNestedPaths: leaves a flat selection untouched', () => {
    const paths = [abs('proj', 'a.txt'), abs('proj', 'b.txt')];
    assert.deepEqual(pruneNestedPaths(paths), paths);
});

// --- buildClipboardTimeoutMessage ---

test('buildClipboardTimeoutMessage: points at the selection size for multi-item copies', () => {
    const message = buildClipboardTimeoutMessage(12000, 10000);
    assert.match(message, /12000 items/);
    assert.match(message, /10s/);
    assert.match(message, /fewer items|ZIP/);
});

test('buildClipboardTimeoutMessage: blames the clipboard, not the count, for a single item', () => {
    const message = buildClipboardTimeoutMessage(1, 10000);
    assert.doesNotMatch(message, /fewer items/);
    assert.match(message, /Another app/);
});

test('runProcess: a timeout rejects with ProcessTimeoutError carrying the budget', async () => {
    const slow = process.platform === 'win32'
        ? { cmd: 'powershell.exe', args: ['-NoProfile', '-Command', 'Start-Sleep -Seconds 5'] }
        : { cmd: 'sleep', args: ['5'] };
    await assert.rejects(
        runProcess(slow.cmd, slow.args, { timeoutMs: 150 }),
        (error: unknown) => error instanceof ProcessTimeoutError && error.timeoutMs === 150
    );
});

// --- buildMacPasteboardScript ---

test('buildMacPasteboardScript: escapes quotes and backslashes', () => {
    const script = buildMacPasteboardScript(['/tmp/say "hi"/back\\slash.txt']);
    assert.ok(script.includes('copy "/tmp/say \\"hi\\"/back\\\\slash.txt" to end of filePaths'));
});

test('buildMacPasteboardScript: escapes newlines in filenames (valid on APFS)', () => {
    const script = buildMacPasteboardScript(['/tmp/line\nbreak\r.txt']);
    assert.ok(script.includes('copy "/tmp/line\\nbreak\\r.txt" to end of filePaths'));
});

test('buildMacPasteboardScript: normalizes decomposed unicode to NFC', () => {
    const decomposed = '/tmp/cafe\u0301.txt'; // "e" + combining acute (HFS+ style)
    const composed = '/tmp/caf\u00e9.txt';    // single precomposed codepoint
    const script = buildMacPasteboardScript([decomposed]);
    assert.ok(script.includes(composed));
    assert.ok(!script.includes(decomposed));
});

test('buildMacPasteboardScript: writes to the general pasteboard', () => {
    const script = buildMacPasteboardScript(['/tmp/a.txt']);
    assert.ok(script.includes("NSPasteboard's generalPasteboard()"));
    assert.ok(script.includes("pb's clearContents()"));
    assert.ok(script.includes("pb's writeObjects:fileURLs"));
});

// Without the trailing delay the pasteboard server drops whatever is still in flight
// when osascript exits, so large selections silently lose items.
test('buildMacPasteboardScript: waits for the pasteboard write to drain before exiting', () => {
    const script = buildMacPasteboardScript(['/tmp/a.txt'], 0.25);
    assert.ok(script.includes('delay 0.25'));
    assert.ok(script.trimEnd().endsWith('delay 0.25'), 'the delay must be the last statement');
});

// --- macSettleSeconds ---

test('macSettleSeconds: grows with the item count and is capped', () => {
    assert.ok(macSettleSeconds(1) < macSettleSeconds(50));
    assert.ok(macSettleSeconds(50) < macSettleSeconds(300));
    assert.ok(macSettleSeconds(100000) <= 4);
});

test('macSettleSeconds: each retry waits longer, within the process timeout', () => {
    const count = 12;
    assert.ok(macSettleSeconds(count, 1) > macSettleSeconds(count, 0));
    assert.ok(macSettleSeconds(count, 2) > macSettleSeconds(count, 1));
    assert.ok(macSettleSeconds(10000, 2) * 1000 < PROCESS_TIMEOUT_MS);
});

// --- buildGnomeClipboardContent ---

test('buildGnomeClipboardContent: copy header plus one file URI per line', () => {
    const p1 = abs('home', 'user', 'a.txt');
    const p2 = abs('home', 'user', 'dir');
    const content = buildGnomeClipboardContent([p1, p2]);
    const lines = content.split('\n');
    assert.equal(lines[0], 'copy');
    assert.equal(lines[1], pathToFileURL(p1).toString());
    assert.equal(lines[2], pathToFileURL(p2).toString());
});

test('buildGnomeClipboardContent: percent-encodes special characters', () => {
    const p = abs('home', 'user', 'my file #1.txt');
    const content = buildGnomeClipboardContent([p]);
    assert.ok(content.includes(pathToFileURL(p).toString()));
    if (process.platform !== 'win32') {
        // Pin the exact wire format Nautilus parses, independent of pathToFileURL.
        assert.ok(content.includes('file:///home/user/my%20file%20%231.txt'));
    }
});

test('chooseLinuxClipboardTool: prefers the tool matching the display session', () => {
    assert.equal(chooseLinuxClipboardTool(true, true, { wayland: 'wayland-0' }), 'wl-copy');
    assert.equal(chooseLinuxClipboardTool(true, true, { x11: ':0' }), 'xclip');
});

test('chooseLinuxClipboardTool: falls back to the installed tool', () => {
    assert.equal(chooseLinuxClipboardTool(false, true, { wayland: 'wayland-0' }), 'xclip');
    assert.equal(chooseLinuxClipboardTool(true, false, { x11: ':0' }), 'wl-copy');
    assert.equal(chooseLinuxClipboardTool(false, false, { x11: ':0' }), undefined);
});

// --- runProcess ---

test('runProcess: resolves with stdout on success', async () => {
    const out = await runProcess('node', ['-e', 'process.stdout.write("hello")']);
    assert.equal(out, 'hello');
});

test('runProcess: pipes stdin to the child', async () => {
    const out = await runProcess('node', ['-e', 'process.stdin.pipe(process.stdout)'], { stdin: 'echoed' });
    assert.equal(out, 'echoed');
});

test('runProcess: rejects with stderr on non-zero exit', async () => {
    await assert.rejects(
        runProcess('node', ['-e', 'console.error("boom"); process.exit(3)']),
        /boom/
    );
});

test('runProcess: rejects with exit code when stderr is empty', async () => {
    await assert.rejects(
        runProcess('node', ['-e', 'process.exit(7)']),
        /exited with code 7/
    );
});

test('runProcess: rejects with a clear launch error for missing executables', async () => {
    await assert.rejects(
        runProcess('definitely-not-a-real-command-xyz', []),
        /Failed to launch definitely-not-a-real-command-xyz/
    );
});

test('runProcess: launchErrorMessage overrides the default launch error', async () => {
    await assert.rejects(
        runProcess('definitely-not-a-real-command-xyz', [], {
            launchErrorMessage: () => 'custom hint'
        }),
        /custom hint/
    );
});

test('runProcess: kills processes that exceed the timeout', async () => {
    await assert.rejects(
        runProcess('node', ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 }),
        /timed out after 0.3s/
    );
});

// --- runCommandExists ---

test('runCommandExists: true for a command on PATH', async () => {
    assert.equal(await runCommandExists('node'), true);
});

test('runCommandExists: false for a missing command', async () => {
    assert.equal(await runCommandExists('definitely-not-a-real-command-xyz'), false);
});
