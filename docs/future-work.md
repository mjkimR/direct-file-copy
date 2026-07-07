# Future Work

Ideas that are worth doing but intentionally not implemented yet. Documented here so the context isn't lost.

## Candidates

- **Remote SSH / Dev Container support** — decided against (2026-07). An `extensionKind: ["ui"]` + download-to-local-temp approach would work in principle, but it roughly doubles the extension's surface (file transfer layer, temp-file lifecycle/GC, progress + cancellation UX), risks regressing the working WSL flow (which depends on running *inside* WSL: `wslpath`, interop PowerShell), and the SSH + UI-extension-host combination can't be covered by CI. VS Code's built-in remote Explorer already has right-click → "Download..." which covers the need — the remote-block error message now points users to it.
- **Cut mode** — decided against for now (2026-07). Linux gnome format supports it trivially (`cut\n` header), Windows needs a `Preferred DropEffect` DataObject, macOS has no native pasteboard cut. Platform inconsistency makes the UX confusing.
- **Marketplace publishing polish** — `icon`, CI `vsce package` check to catch manifest/`.vscodeignore` mistakes. Only relevant if/when publishing.
- **macOS keybinding conflict** — resolved (2026-07): macOS now uses `ctrl+c` via the `mac` field in `contributes.keybindings` (`alt+c` with `editorTextFocus` shadowed Option+C "ç" on international layouts; Ctrl+C is free on macOS since system copy is Cmd+C). An earlier report that Ctrl-combos only captured 1 of N files turned out to be the probabilistic pasteboard-drop bug (fixed with verify+retry), not the modifier — confirmed by stress test: raw writes still drop items ~1/30 runs, `copyMac` 0/30.
- **ESLint** — no linting yet; CI only compiles and tests. Cheap to add if the codebase grows.
- **Broken symlinks are filtered out** — the `fs.existsSync` filter in `extension.ts` follows symlinks, so a symlink whose target is gone can't be copied even though Finder/Explorer can copy the link itself. Switching to an `lstat`-based check would fix it; low priority.
