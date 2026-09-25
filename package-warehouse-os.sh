#!/usr/bin/env bash
set -e

# Package script to create a clean, standalone, white-labeled ZIP distribution
OUTPUT_DIR="${1:-$HOME/Downloads}"
ZIP_NAME="warehouse-os-v1.0.zip"
TARGET_PATH="$OUTPUT_DIR/$ZIP_NAME"

echo "📦 Packaging clean Warehouse OS distribution to $TARGET_PATH..."

zip -r "$TARGET_PATH" . \
  -x "node_modules/*" \
  -x "client/node_modules/*" \
  -x "server/node_modules/*" \
  -x "client/dist/*" \
  -x ".git/*" \
  -x ".env" \
  -x "server/.env" \
  -x ".DS_Store" \
  -x "*/.DS_Store" \
  -x "*.zip"

echo "✅ Clean standalone ZIP created at: $TARGET_PATH"
