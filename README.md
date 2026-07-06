# Direct File Copy (VS Code Extension)

**Direct File Copy** is a lightweight VS Code extension that allows you to copy selected files and folders as native system clipboard file objects. 

This enables you to paste the files themselves directly into:
- System file explorers (macOS Finder, Windows File Explorer, Linux Nautilus/Thunar/PCManFM, etc.)
- Collaboration/chat applications (Slack, Microsoft Teams, Discord, etc.)
- Web browsers or standard upload dialogs.

---

## Features

- **Multi-Location Context Menus**: Right-click to copy from:
  - **VS Code Explorer**: Click on one or multiple files/folders and select **"Copy as File Object"**.
  - **Editor Workspace**: Right-click inside the file editor text area.
  - **Editor Tab Header**: Right-click on any open editor file tab title.
  - **Source Control View**: Right-click changed files in the Git SCM view to copy them (handy for sharing exactly the files you changed; deleted files are skipped automatically).
- **Improved Keyboard Shortcut (`alt+c`)**: 
  - Works when focusing the **File Explorer** (`filesExplorerFocus`).
  - Works directly inside the **Active Text Editor** (`editorTextFocus`) to copy the currently open file without clicking the explorer.
- **Active Editor Fallback**: If triggered without a selection or context, it automatically falls back to copying the file currently open in the active editor.
- **Clean Notifications**: Shows the copied file name (for single items) or a clean count like `Copied 3 items as file objects.` (for multiple items) to prevent notifications from getting truncated. Prefer something quieter? Set `directFileCopy.notificationStyle` to `statusBar` for a transient status bar message instead of a popup.
- **Cross-Platform Support**:
  - **macOS**: Native integration via Cocoa Frameworks (`NSPasteboard` and `NSURL` objects via AppleScript) ensuring zero dependencies and compatibility with macOS Finder, Slack, etc.
  - **Windows**: Built-in PowerShell (`-STA` mode) & .NET `SetFileDropList` clipboard integration.
  - **Linux**: Supports standard file copy formats (`x-special/gnome-copied-files`) using `wl-copy` (Wayland) or `xclip` (X11).
  - **WSL2 (Windows Subsystem for Linux)**: Automatically converts Linux-style WSL paths (e.g. `/home/user/...` or `/mnt/c/...`) into Windows-compatible paths and UNC paths (using `wslpath`) and writes them directly to the Windows host clipboard using the host's PowerShell. Requires **WSL2 with Windows interop enabled** (the default); WSL1 and setups with interop/`appendWindowsPath` disabled in `/etc/wsl.conf` are not supported and will report a clear error.
  - **Remote Dev Check**: Gracefully blocks other remote development environments (SSH, Dev Containers) with a clear warning notification instead of failing silently.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `directFileCopy.notificationStyle` | `popup` | How to confirm a successful copy: `popup` (information notification) or `statusBar` (transient status bar message, auto-dismisses after 3s). |

---

## Roadmap

See [docs/future-work.md](docs/future-work.md) for ideas under consideration (e.g. Remote SSH support via a UI-side extension host).

---

## OS Requirements (Linux only)

For Linux users, make sure you have either `wl-clipboard` (for Wayland) or `xclip` (for X11) installed:
- **Debian/Ubuntu**: `sudo apt install wl-clipboard xclip`
- **Fedora/RHEL**: `sudo dnf install wl-clipboard xclip`
- **Arch Linux**: `sudo pacman -S wl-clipboard xclip`

---

## Installation & Development

To compile and run the extension locally:

1. Clone or open this repository in VS Code.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile and package the extension:
   ```bash
   ./build.sh
   ```
4. Press `F5` in VS Code to launch the **Extension Development Host**.
5. In the new window, select files in the explorer and use `alt+c` or right-click and choose **"Copy as File Object"** to copy files, then paste them anywhere!
