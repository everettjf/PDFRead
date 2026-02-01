#!/bin/bash
set -e  # Exit on any error

APPNAME="PDFRead"

# Clean any previous build artifacts
echo "Cleaning previous builds..."
rm -rf dist
rm -rf src-tauri/target/release/bundle

# Make sure dependencies are installed
echo "Installing dependencies..."
bun install

# Build the Tauri app for macOS
echo "Building Tauri app for macOS..."
bun run tauri build --bundles dmg

echo "Build completed!"
echo "DMG location: src-tauri/target/release/bundle/dmg/"
