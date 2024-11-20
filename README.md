# Experimenting with WASM & AudioWorklets

## Overview

This project demonstrates how to process audio in real-time using WebAssembly (Wasm) and the Web Audio API. The main goal is to process audio samples using a custom audio processor implemented in Rust and compiled to Wasm. It establishes a peer-to-peer (P2P) connection to stream audio between browsers with minimal latency.

## Project Structure

- **`crates/`**: Contains Rust crates for the server and Wasm modules
- **`www/`**: Contains HTML, CSS, and JavaScript files for the web interface
- **`static/js/`**: Contains JavaScript modules including the FreeQueue implementation
- **`docs/`**: Contains documentation and references

## Audio Flow

1. **Audio Context**: The JavaScript code initializes an `AudioContext` for managing audio processing.

2. **Buffers**:

   - Audio samples are managed through a ring buffer implementation (FreeQueue)
   - Samples are converted between float format (Web Audio API) and appropriate formats for Wasm processing

3. **Wasm Module**:

   - Audio samples are passed to the Wasm module through shared memory
   - The Wasm module processes the audio samples and writes results back to memory

4. **Audio Worklet**:

   - An `AudioWorkletNode` handles real-time audio processing in a separate thread
   - The worklet communicates with the Wasm module through shared memory buffers

5. **Playback**:
   - Processed audio samples are played back through the audio context
   - The system maintains low latency for real-time audio effects

## Peer-to-Peer Connection

- Uses WebRTC for direct browser-to-browser audio streaming
- Includes a Cloudflare Worker for signaling and connection establishment
- Supports real-time audio processing and playback between peers

## Running the Demo

1. Clone the repo
2. Run `./build.sh && cargo run -p decay-server`
3. Open your browser and navigate to `https://localhost:3443`

## Resources

- https://developer.chrome.com/blog/audio-worklet-design-pattern/
- https://wasmbyexample.dev/examples/reading-and-writing-audio/reading-and-writing-audio.rust.en-us
- https://www.toptal.com/webassembly/webassembly-rust-tutorial-web-audio
- https://emscripten.org/docs/api_reference/wasm_audio_worklets.html
- https://dev.to/speratus/how-i-used-wasm-pack-to-build-a-webassembly-module-for-an-audioworkletprocessor-4aa7
