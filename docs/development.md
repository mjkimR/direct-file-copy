# Development

How to build, run, and test the extension from source.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- VS Code
- Linux only: `wl-clipboard` (Wayland) or `xclip` (X11) to exercise the clipboard backends

## Setup

```bash
npm install
```

## Run in the Extension Development Host

1. Open this repository in VS Code.
2. Press `F5` to launch the **Extension Development Host**.
3. In the new window, select files in the Explorer and use `Alt+C` (macOS: `Ctrl+C`) or right-click → **"Copy as File Object"**, then paste them anywhere.

## Build a VSIX

```bash
./build.sh
```

This installs dependencies, compiles TypeScript, and packages a `.vsix` via `@vscode/vsce`.

To compile without packaging:

```bash
npm run compile   # one-off
npm run watch     # recompile on change
```

## Tests

```bash
npm run test:unit        # pure-logic unit tests
npm run test:clipboard   # real clipboard round-trip tests (per platform)
```

CI runs both across an Ubuntu / macOS / Windows matrix.

## Lint

```bash
npm run lint
```

## Design notes

See [design-notes.md](design-notes.md) for the reasoning behind features that were deliberately left out, and notes on known limitations.
