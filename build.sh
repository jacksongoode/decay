#!/bin/bash
set -e  # Exit on error

# Create necessary directories
mkdir -p crates/decay-server/src

# Install dependencies with Bun
echo "Installing dependencies..."
bun install

echo "Building server..."
cargo clean -p decay-server
cargo build -p decay-server

# Check if certificates exist, if not create them
if [ ! -f "certs/cert.pem" ] || [ ! -f "certs/key.pem" ]; then
    echo "Generating SSL certificates..."
    mkdir -p certs
    openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/CN=localhost"
fi

echo "Build complete! Run 'bun start' to start the server"