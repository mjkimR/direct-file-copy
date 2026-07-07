# Changelog

All notable changes to the **Direct File Copy** extension are documented here.

## [Unreleased]

### Changed
- macOS keybinding is now `ctrl+c` (Windows/Linux keep `alt+c`): `alt+c` in the editor shadowed Option+C ("ç") on international keyboard layouts, and Ctrl+C is free on macOS since system copy is Cmd+C.

### Added
- Git SCM view context menu: copy changed files directly from the Source Control view (deleted files are skipped automatically).
- `directFileCopy.notificationStyle` setting: choose between a `popup` notification (default) or a transient `statusBar` message.
- Test suite: unit tests for all pure logic (`npm run test:unit`) and real clipboard round-trip tests per platform (`npm run test:clipboard`), plus a GitHub Actions matrix (Ubuntu/macOS/Windows) running both.

### Fixed
- macOS: multi-file copies no longer silently drop trailing items. The pasteboard server could lose items when osascript exited right after `writeObjects` (~7% of writes in testing); the write is now flushed and verified from a separate process, with automatic retry.
- External clipboard processes (osascript / PowerShell / wl-copy / xclip / wslpath) no longer hang silently when the executable is missing or the process never exits — they now fail with a clear error, with a 10s timeout as a backstop.
- WSL: launching Windows PowerShell with interop disabled now reports a clear error explaining the `/etc/wsl.conf` requirement (WSL2 + interop required).
- Keyboard-shortcut path detection no longer treats unsaved documents (e.g. `Untitled-1`) as copyable files.
- The original clipboard text is now always restored after keyboard-shortcut path detection, so a copy that fails afterwards no longer leaves file-path text on the clipboard.
- Unsupported remote sessions are now rejected before the clipboard workaround runs, instead of after, and the error message suggests the built-in Explorer "Download..." as an alternative.
- macOS: filenames containing newlines (allowed on APFS) no longer break the pasteboard AppleScript.

## [0.1.0] - 2026-07-03

### Added
- Initial release: copy selected files/folders as native OS clipboard file objects, pasteable into Finder / File Explorer / chat apps.
- Context menus in the file explorer, editor area, and editor tab header; `alt+c` keybinding with active-editor fallback.
- Cross-platform backends: macOS (NSPasteboard via AppleScript), Windows (PowerShell `SetFileDropList`), Linux (`wl-copy`/`xclip`, gnome copied-files format), WSL2 (via `wslpath` + host PowerShell).
