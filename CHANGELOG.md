# Changelog

All notable changes to the **Direct File Copy** extension are documented here.

## [1.1.1]

### Changed
- Updated extension icon (`resources/icon.png`) to improve contrast and visibility across dark themes and the VS Code Marketplace.
- Updated dependencies (`brace-expansion`, `js-yaml`) to resolve security vulnerabilities.

## [1.1.0]

### Fixed
- macOS: copying more than a handful of items silently dropped some of them, and larger selections failed outright with `Pasteboard write incomplete: expected N items, found M`. `NSPasteboard` hands items to the pasteboard server asynchronously, so anything still in flight was discarded when the helper process exited — the loss scaled with the selection size (12 items arrived as 9). The helper now waits for the write to drain before exiting, and the existing verification retries with a longer wait. Verified up to 12,000 items.
- Selecting a folder together with files or subfolders inside it no longer copies those children twice — once inside the folder and once beside it (and, for **Copy as ZIP File Object**, as duplicate entries at the archive root). Items already covered by a selected ancestor are dropped from the selection.

### Changed
- Clipboard timeouts now explain that the selection is likely too large and suggest copying fewer items or using **Copy as ZIP File Object**, instead of reporting a bare `osascript timed out after 10s`.

## [1.0.2]

### Added
- Unsaved-change protection: selected files, including open files inside selected folders, can be saved before their on-disk file objects are copied. The new `directFileCopy.saveBeforeCopy` setting supports `prompt`, `always`, and `never` policies.
- Success messages now identify copied files and report selected items that were skipped because they no longer exist.
- Source Control context-menu support now works with any SCM provider backed by local file URIs, rather than Git only.
- Source Control resource groups now offer **Copy All Changes as File Objects**.
- **Copy as ZIP File Object** bundles selected files and folders into a single archive using a bundled cross-platform compressor. Temporary archives remain pasteable for 24 hours and are then cleaned automatically.
- **Diagnose Setup** reports the active backend, required clipboard tools, WSL interop readiness, display-session details, and KDE compatibility warnings.
- Missing Linux clipboard-tool errors now offer actions to open setup instructions or copy a distribution-specific install command.

### Changed
- Success notifications now use the unobtrusive status bar by default; popup notifications remain available through `directFileCopy.notificationStyle`.
- Explorer and editor keyboard-shortcut invocations are distinguished explicitly. If Explorer selection detection fails, the extension now warns instead of silently copying the active editor file.
- Command Palette entries are grouped under the `Direct File Copy` category.
- Linux now prefers `wl-copy` in Wayland sessions and `xclip` in X11 sessions when both tools are installed.

## [1.0.1] - 2026-07-16

Documentation-only release; no functional or behavioral changes.

### Changed
- Rewrote the README as a marketplace-focused overview: clearer usage steps, a dedicated keyboard-shortcut reference (per-platform defaults and how to rebind), and a platform-support table.
- Moved build, run, test, and lint instructions out of the README into `docs/development.md`.

## [1.0.0] - 2026-07-08

First stable release — the feature scope is complete; future releases are expected to be bug fixes only.

### Changed
- macOS keybinding is now `ctrl+c` (Windows/Linux keep `alt+c`): `alt+c` in the editor shadowed Option+C ("ç") on international keyboard layouts, and Ctrl+C is free on macOS since system copy is Cmd+C.

### Added
- Git SCM view context menu: copy changed files directly from the Source Control view (deleted files are skipped automatically).
- `directFileCopy.notificationStyle` setting: choose between a `popup` notification (default) or a transient `statusBar` message.
- Test suite: unit tests for all pure logic (`npm run test:unit`) and real clipboard round-trip tests per platform (`npm run test:clipboard`), plus a GitHub Actions matrix (Ubuntu/macOS/Windows) running both.
- ESLint (TypeScript recommended flat config) with a lint step in CI.

### Fixed
- Linux: copying no longer fails with a spurious 10-second timeout. `xclip`/`wl-copy` fork a daemon to keep serving the clipboard selection, which held the spawned process's pipes open — the copy itself succeeded but was reported as a failure. Their output streams are now detached.
- Broken symlinks can now be copied: the existence filter uses `lstat` and no longer follows symlink targets, matching what Finder/Explorer allow.
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
