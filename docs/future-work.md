# Future Work

Ideas that are worth doing but intentionally not implemented yet. Documented here so the context isn't lost.

## Remote SSH / Dev Container support (not implemented)

**Status**: idea only — currently the extension explicitly blocks non-WSL remotes with an error (`extension.ts`, remote check in the command handler).

### Why it's currently blocked

The extension works by spawning OS-native clipboard tools (`osascript`, `powershell.exe`, `wl-copy`/`xclip`). In a Remote SSH or Dev Container session the extension host runs **on the remote machine**, so those spawns would write to the *remote* clipboard (or fail), never reaching the local OS clipboard the user actually pastes from.

### The approach that would make it work

VS Code lets an extension declare where it runs via `extensionKind` in `package.json`:

```json
"extensionKind": ["ui"]
```

With `"ui"`, the extension runs **on the local machine even during remote sessions**. From there:

1. Resolve the selected remote files via `vscode.workspace.fs` (works transparently across the remote bridge — `vscode-remote://` URIs are readable from a UI extension).
2. Download them to a local temp directory (`context.globalStorageUri` or `os.tmpdir()`), preserving relative structure for folder copies.
3. Run the existing native clipboard path (`copyMac`/`copyWindows`/`copyLinux`) against the **local temp copies**.
4. Paste target receives real local files.

This would enable "copy a file on the SSH server, paste it into local Slack/Finder" — something no mainstream editor currently does.

### Design questions to settle before implementing

- **`extensionKind` trade-off**: switching to `["ui"]` changes where the extension runs for *all* scenarios, including WSL. The current WSL flow depends on running *inside* WSL (`wslpath`, interop PowerShell). Likely need `["ui", "workspace"]` ordering or a two-part strategy, and careful testing that WSL behavior doesn't regress. This is the riskiest part.
- **Folders & large files**: recursive download of a big directory could be slow/huge. Need a size cap + progress UI (`vscode.window.withProgress`) + cancellation.
- **Temp lifecycle**: when to delete downloaded copies? Immediately after copy is wrong (paste happens later). Candidates: cleanup on extension deactivate, on next copy, or a TTL sweep on activation.
- **Staleness semantics**: the pasted file is a snapshot, not the live remote file. Probably fine, but should be stated in the README.
- **Symlinks / permissions / sparse checkouts**: decide follow-vs-skip for symlinks; permission bits are lost through `workspace.fs`.

### Effort estimate

Medium-large. The clipboard side is already done; the work is the download layer, the `extensionKind` migration (incl. WSL regression testing), and progress/cancellation UX.

## Other candidates (smaller)

- **Cut mode** — decided against for now (2026-07). Linux gnome format supports it trivially (`cut\n` header), Windows needs a `Preferred DropEffect` DataObject, macOS has no native pasteboard cut. Platform inconsistency makes the UX confusing.
- **Marketplace publishing polish** — `icon`, `keywords`, `LICENSE`, `CHANGELOG.md`, `.vscodeignore`. Only relevant if/when publishing.
