# Experimenting with WASM & AudioWorklets

## Overview

This project demonstrates how to process audio in real-time using WebAssembly (Wasm) and the Web Audio API. The main goal is to amplify audio samples and apply effects like pitch shifting using a custom audio processor implemented in Rust and compiled to Wasm. Additionally, it establishes a peer-to-peer (P2P) connection to stream audio from an input source to an output destination.

## Project Structure

- **`src/`**: Contains the Rust source code for the audio processing logic.
- **`www/`**: Contains HTML, CSS, and JavaScript files for the user interface and audio handling.
- **`wasm/`**: Contains the compiled WebAssembly modules.
- **`static/js/`**: Contains JavaScript files that manage audio processing and communication with the Wasm module.

## Audio Flow

1. **Audio Context**: The JavaScript code initializes an `AudioContext`, which is the main interface for managing and playing audio in the browser.

2. **Buffers**:

   - An audio buffer is created to hold audio samples. This buffer is filled with audio data (e.g., a simple square wave).
   - The audio samples are converted from float format (used by the Web Audio API) to byte format (used by Wasm).

3. **Wasm Module**:

   - The audio samples are passed to the Wasm module through a pointer to the input buffer.
   - The Wasm module processes the audio samples (e.g., amplifying them) and writes the results to an output buffer.

4. **Audio Worklet**:

   - An `AudioWorkletNode` is created to handle audio processing in a separate thread. This node connects the audio context to the Wasm module.
   - The worklet processes incoming audio data and communicates with the Wasm module to perform audio processing.

5. **Playback**:
   - The processed audio samples are converted back to float format and set in the audio buffer.
   - The audio buffer is played back through the audio context.

## Peer-to-Peer Connection

- The architecture allows for a P2P connection to stream audio directly from an input source (like a microphone or audio file) to an output destination (like speakers or headphones).
- This enables real-time audio processing and playback, allowing users to experience the effects of the audio processing immediately.

## How to Connect Peers

- The audio processing is done in a single-threaded manner, but the architecture allows for easy integration of multiple audio processing nodes.
- Each `AudioWorkletNode` can be connected to other nodes in the audio graph, allowing for complex audio processing chains.

## Running the Demo

1. Clone the repo
1. Run `./build.sh && cargo run -p decay-server`
1. Open your browser and navigate to `https://localhost:3443`.


## Resources
- https://developer.chrome.com/blog/audio-worklet-design-pattern/
- https://wasmbyexample.dev/examples/reading-and-writing-audio/reading-and-writing-audio.rust.en-us
- https://www.toptal.com/webassembly/webassembly-rust-tutorial-web-audio
- https://emscripten.org/docs/api_reference/wasm_audio_worklets.html