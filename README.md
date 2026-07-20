# Direct File Copy

Copy files and folders from VS Code as **real system-clipboard file objects** — so you can paste the actual files, not just their text or path, into any app that accepts files.

Paste the copied files straight into:

- **File managers** — macOS Finder, Windows File Explorer, Linux Nautilus / Thunar / PCManFM
- **Chat & collaboration apps** — Slack, Microsoft Teams, Discord
- **AI chat** — paste files into a ChatGPT or Claude conversation (web or desktop app)
- **Browsers & upload dialogs** — any file-drop field or upload prompt

---

## Usage

Select one or more files/folders, then either:

- Right-click → **"Copy as File Object"**, or
- Right-click → **"Copy as ZIP File Object"** to bundle the selection into one archive, or
- Press the keyboard shortcut (see below).

Then paste (`Cmd`/`Ctrl+V`) the copied file objects wherever you need them, including file-drop fields.

You can copy from several places:

- **Explorer** — one or multiple selected files/folders.
- **Editor** — right-click in the text area, or on the tab header, to copy the open file.
- **Source Control** — right-click changed files from any local-file SCM provider to copy exactly what you changed. Right-click a Changes group and choose **"Copy All Changes as File Objects"** to copy the whole group at once. Deleted files are skipped and reported automatically.

When run from the Command Palette without an explicit selection, it falls back to the file open in the active editor. An Explorer shortcut that cannot resolve its selection warns instead of copying an unrelated editor file.

If a selected file—or a file inside a selected folder—has unsaved changes, Direct File Copy asks whether to save it before copying. This prevents accidentally sharing an older on-disk version.

### ZIP archives

ZIP mode is useful when a target app does not accept folders or several pasted files. Compression is built into the extension, so no separate ZIP tool is required. Temporary archives are kept in the extension's private storage so the clipboard remains pasteable, then removed automatically after 24 hours.

---

## Keyboard shortcut

| Platform | Default | Active when |
|---|---|---|
| Windows / Linux | `Alt` + `C` | the Explorer or the active editor is focused |
| macOS | `Ctrl` + `C` | the Explorer or the active editor is focused |

> macOS uses `Ctrl+C` instead of `Alt+C` because `Alt+C` types `ç` in the editor on international layouts. `Ctrl+C` is free on macOS since the system copy is `Cmd+C`.

### Change the shortcut

1. Open **Keyboard Shortcuts** — press `Ctrl+K Ctrl+S` (macOS: `Cmd+K Cmd+S`), or run **"Preferences: Open Keyboard Shortcuts"** from the Command Palette.
2. Search for **Copy as File Object**.
3. Click the pencil icon next to it and press your new key combination.

Prefer editing JSON? Open **"Preferences: Open Keyboard Shortcuts (JSON)"** from the Command Palette and add entries for the Explorer and editor contexts:

```jsonc
[
  {
    "key": "ctrl+alt+c",            // your preferred combination
    "command": "copy-file-object.copy",
    "args": { "invocationSource": "explorer" },
    "when": "filesExplorerFocus"
  },
  {
    "key": "ctrl+alt+c",
    "command": "copy-file-object.copy",
    "args": { "invocationSource": "editor" },
    "when": "editorTextFocus"
  }
]
```

---

## Platform support

| Platform | How it works | Requirements |
|---|---|---|
| **macOS** | Native `NSPasteboard` / `NSURL` objects via AppleScript | None (built in) |
| **Windows** | PowerShell (`-STA`) + .NET `SetFileDropList` | None (built in) |
| **Linux** | `x-special/gnome-copied-files` via `wl-copy` (Wayland) or `xclip` (X11) | `wl-clipboard` or `xclip` |
| **WSL2** | Converts WSL paths with `wslpath` and writes to the Windows host clipboard via host PowerShell | WSL2 with Windows interop enabled (the default) |

Remote sessions where the clipboard can't reach your machine (SSH, Dev Containers) are detected and reported clearly, with a pointer to the Explorer's built-in **"Download…"**. WSL1, or WSL2 with interop disabled in `/etc/wsl.conf`, is not supported and reports a clear error.

> **KDE Dolphin:** Linux clipboard support currently targets Nautilus, Thunar, and PCManFM. Dolphin requires additional KDE-specific clipboard formats and is not supported yet.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `directFileCopy.notificationStyle` | `statusBar` | How to confirm a successful copy: `statusBar` (transient status bar message, auto-dismisses after 3s) or `popup` (information notification). |
| `directFileCopy.saveBeforeCopy` | `prompt` | How to handle unsaved selected files: ask first, always save, or copy the last saved version. |

---

## Requirements (Linux only)

Install either `wl-clipboard` (Wayland) or `xclip` (X11):

- **Debian/Ubuntu**: `sudo apt install wl-clipboard xclip`
- **Fedora/RHEL**: `sudo dnf install wl-clipboard xclip`
- **Arch Linux**: `sudo pacman -S wl-clipboard xclip`

If neither tool is available, the error notification can open these instructions or copy the correct install command for your distribution.

### Diagnose setup

Run **"Direct File Copy: Diagnose Setup"** from the Command Palette to inspect the selected clipboard backend, Linux display tools, WSL interop, and known compatibility warnings. The report opens in the Output panel and can be copied without exposing file contents or paths.

---

## Links

- [Changelog](CHANGELOG.md)
- [Development / building from source](docs/development.md)

## License

[MIT](LICENSE)
