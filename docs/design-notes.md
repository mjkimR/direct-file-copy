# Design notes

Records the reasoning behind features that were deliberately left out, decisions already resolved, and known limitations — so the context isn't lost.

## Items

- **Remote SSH / Dev Container support** — decided against (2026-07). An `extensionKind: ["ui"]` + download-to-local-temp approach would work in principle, but it roughly doubles the extension's surface (file transfer layer, temp-file lifecycle/GC, progress + cancellation UX), risks regressing the working WSL flow (which depends on running *inside* WSL: `wslpath`, interop PowerShell), and the SSH + UI-extension-host combination can't be covered by CI. VS Code's built-in remote Explorer already has right-click → "Download..." which covers the need — the remote-block error message now points users to it.
- **Cut mode** — decided against for now (2026-07). Linux gnome format supports it trivially (`cut\n` header), Windows needs a `Preferred DropEffect` DataObject, macOS has no native pasteboard cut. Platform inconsistency makes the UX confusing.
- **Marketplace publishing polish** — `icon`, CI `vsce package` check to catch manifest/`.vscodeignore` mistakes. Only relevant if/when publishing.
- **macOS keybinding conflict** — resolved (2026-07): macOS now uses `ctrl+c` via the `mac` field in `contributes.keybindings` (`alt+c` with `editorTextFocus` shadowed Option+C "ç" on international layouts; Ctrl+C is free on macOS since system copy is Cmd+C). An earlier report that Ctrl-combos only captured 1 of N files turned out to be the probabilistic pasteboard-drop bug (fixed with verify+retry), not the modifier — confirmed by stress test: raw writes still drop items ~1/30 runs, `copyMac` 0/30.
- **ESLint** — resolved (2026-07): configured ESLint with TypeScript recommended flat config and added lint checks to CI.
- **Broken symlinks are filtered out** — resolved (2026-07): Switched the `fs.existsSync` filter in `extension.ts` to an async `fs.promises.lstat` check, allowing broken symlinks themselves to be copied by the native backends.
- **KDE Dolphin paste (Linux)** — known limitation (2026-07). The Linux backend only offers the `x-special/gnome-copied-files` target, which Nautilus/Thunar/PCManFM read but Dolphin does not (it wants `text/uri-list` + `application/x-kde-cutselection`). wl-copy and xclip can each serve only a single MIME type per invocation, and spawning two steals selection ownership from the first — offering both targets would need a persistent clipboard helper process. Not worth the surface for now.
