// Real clipboard round-trip tests: write file objects with the same code the
// extension uses, then read the native clipboard back and verify.
//
// These are platform-gated and skip themselves when the environment can't
// support them (wrong OS, no display server, missing tools). Run via:
//   npm run test:clipboard
// NOTE: running these locally overwrites your current clipboard.
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    buildGnomeClipboardContent,
    chooseLinuxClipboardTool,
    copyLinux,
    copyMac,
    copyWindows,
    runCommandExists,
    runProcess
} from '../../core';

const platform = process.platform;

function makeTempFiles(names: string[]): string[] {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-file-copy-test-'));
    return names.map(name => {
        const p = path.join(dir, name);
        fs.writeFileSync(p, `test content: ${name}`);
        return p;
    });
}

function assertContainsBasenames(readBackPaths: string[], expected: string[]) {
    const got = new Set(readBackPaths.map(p => path.basename(p)));
    for (const f of expected) {
        assert.ok(got.has(path.basename(f)), `clipboard should contain ${path.basename(f)}, got: ${[...got].join(', ')}`);
    }
}

test('macOS: NSPasteboard round-trip', { skip: platform !== 'darwin' }, async () => {
    const files = makeTempFiles(['plain.txt', 'with space.txt', "quote'name.txt", 'line\nbreak.txt']);
    await copyMac(files);

    // NUL-separated so filenames containing newlines survive the round-trip
    const readScript = [
        'use framework "Foundation"',
        'use framework "AppKit"',
        `set pb to current application's NSPasteboard's generalPasteboard()`,
        `set urls to pb's readObjectsForClasses:{current application's NSURL} options:(missing value)`,
        'set out to ""',
        'repeat with u in urls',
        `    set out to out & (u's path() as text) & (character id 0)`,
        'end repeat',
        'return out'
    ].join('\n');
    const readBack = await runProcess('osascript', [], { stdin: readScript });

    assertContainsBasenames(readBack.split('\u0000').map(s => s.trim()).filter(Boolean), files);
});

// Regression: NSPasteboard delivers items to the pasteboard server asynchronously, so a
// large selection used to arrive truncated (12 files landed as 9) once osascript exited.
test('macOS: NSPasteboard round-trip keeps every item for a large selection', { skip: platform !== 'darwin' }, async () => {
    const files = makeTempFiles(Array.from({ length: 60 }, (_, i) => `bulk_${i + 1}.txt`));
    await copyMac(files);

    const countScript = [
        'use framework "AppKit"',
        `set pb to current application's NSPasteboard's generalPasteboard()`,
        `return (count of ((pb's readObjectsForClasses:{current application's NSURL} options:(missing value)) as list))`
    ].join('\n');
    const readBack = await runProcess('osascript', [], { stdin: countScript });

    assert.equal(parseInt(readBack.trim(), 10), files.length);
});

test('Windows: FileDropList round-trip', { skip: platform !== 'win32' }, async () => {
    const files = makeTempFiles(['plain.txt', 'with space.txt', "quote'name.txt"]);
    await copyWindows(files);

    const readBack = await runProcess(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-Command', '-'],
        { stdin: '(Get-Clipboard -Format FileDropList) | ForEach-Object { $_.FullName }' }
    );

    assertContainsBasenames(readBack.split(/\r?\n/).map(s => s.trim()).filter(Boolean), files);
});

test('Linux: gnome-copied-files round-trip (X11/xclip)', { skip: platform !== 'linux' }, async (t) => {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        return t.skip('no display server available');
    }
    if (!(await runCommandExists('xclip')) && !(await runCommandExists('wl-copy'))) {
        return t.skip('neither xclip nor wl-copy installed');
    }

    const files = makeTempFiles(['plain.txt', 'with space.txt']);
    try {
        await copyLinux(files);

        // Read back with whichever tool copyLinux picked for the current display session.
        const tool = chooseLinuxClipboardTool(
            await runCommandExists('wl-copy'),
            await runCommandExists('xclip')
        );
        const readBack = tool === 'wl-copy'
            ? await runProcess('wl-paste', ['--type', 'x-special/gnome-copied-files'])
            : await runProcess('xclip', ['-selection', 'clipboard', '-t', 'x-special/gnome-copied-files', '-o']);

        assert.equal(readBack.trimEnd(), buildGnomeClipboardContent(files));
    } finally {
        const tool = chooseLinuxClipboardTool(
            await runCommandExists('wl-copy'),
            await runCommandExists('xclip')
        );
        if (tool === 'xclip' && await runCommandExists('pkill')) {
            try {
                await runProcess('pkill', ['xclip']);
            } catch {
                // Ignore if no process matches or pkill fails
            }
        }
    }
});
