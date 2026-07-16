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
- Press the keyboard shortcut (see below).

Then paste (`Cmd`/`Ctrl+V`, or drop onto a target) wherever you need the files.

You can copy from several places:

- **Explorer** — one or multiple selected files/folders.
- **Editor** — right-click in the text area, or on the tab header, to copy the open file.
- **Source Control** — right-click changed files in the Git view to copy exactly what you changed (deleted files are skipped automatically).

Trigger it with nothing selected and it falls back to the file open in the active editor.

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

Prefer editing JSON? Open **"Preferences: Open Keyboard Shortcuts (JSON)"** from the Command Palette and add an entry:

```jsonc
{
  "key": "ctrl+alt+c",              // your preferred combination
  "command": "copy-file-object.copy",
  "when": "filesExplorerFocus || editorTextFocus"
}
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

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `directFileCopy.notificationStyle` | `popup` | How to confirm a successful copy: `popup` (information notification) or `statusBar` (transient status bar message, auto-dismisses after 3s). |

---

## Requirements (Linux only)

Install either `wl-clipboard` (Wayland) or `xclip` (X11):

- **Debian/Ubuntu**: `sudo apt install wl-clipboard xclip`
- **Fedora/RHEL**: `sudo dnf install wl-clipboard xclip`
- **Arch Linux**: `sudo pacman -S wl-clipboard xclip`

---

## Links

- [Changelog](CHANGELOG.md)
- [Development / building from source](docs/development.md)

## License

[MIT](LICENSE)
