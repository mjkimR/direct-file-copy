#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "=== Building Direct File Copy Extension ==="

# 1. Install dependencies
echo "Installing dependencies..."
npm install

# 2. Compile TypeScript
echo "Compiling TypeScript..."
npm run compile

# 3. Package extension
echo "Packaging extension into VSIX..."
if command -v npx &> /dev/null; then
    # Package without publishing. --no-dependencies is optional, vsce packages everything in the root
    npx @vscode/vsce package
else
    echo "Warning: npx is not available. Skipping VSIX packaging."
fi

echo "=== Build Completed Successfully! ==="
