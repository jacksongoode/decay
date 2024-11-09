#!/bin/bash
set -e  # Exit on error

echo "Building WASM module..."
wasm-pack build crates/wasm --target web --out-dir ../../www/static/js/wasm