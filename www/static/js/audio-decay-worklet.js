// Use larger buffer size for better performance
const BUFFER_SIZE = 4096;

class AudioDecayProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    // Get the actual context sample rate
    this.sampleRate = options.processorOptions?.sampleRate;
    console.log(
      "AudioDecayProcessor initialized with sample rate:",
      this.sampleRate,
    );

    // Initialize memory references
    this.wasmMemoryBuffer = null;
    this.inputPtr = null;
    this.outputPtr = null;

    // Request WASM memory from main thread
    this.port.postMessage({ type: "requestWasm" });

    // Handle messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === "init") {
        // Store memory references
        this.wasmMemoryBuffer = event.data.memory.buffer;
        this.inputPtr = event.data.memory.inputPtr;
        this.outputPtr = event.data.memory.outputPtr;
        this.sampleRate = event.data.memory.sampleRate;

        console.log("WASM memory initialized in worklet with:", {
          hasMemoryBuffer: !!this.wasmMemoryBuffer,
          inputPtr: this.inputPtr,
          outputPtr: this.outputPtr,
          sampleRate: this.sampleRate,
        });
      }
    };
  }

  process(inputs, outputs) {
    try {
      const input = inputs[0];
      const output = outputs[0];

      if (!input || !output || !this.wasmMemoryBuffer) {
        return true;
      }

      // Process each channel
      for (let channel = 0; channel < input.length; channel++) {
        // Create views into the shared memory
        const inputBuffer = new Float32Array(
          this.wasmMemoryBuffer,
          this.inputPtr,
          input[channel].length,
        );
        const outputBuffer = new Float32Array(
          this.wasmMemoryBuffer,
          this.outputPtr,
          output[channel].length,
        );

        // Copy input data to shared memory
        inputBuffer.set(input[channel]);

        // Signal the main thread to process the audio
        this.port.postMessage({
          type: "processAudio",
          length: input[channel].length,
        });

        // Copy processed data back to output
        output[channel].set(outputBuffer);
      }

      return true;
    } catch (error) {
      console.error("Error in audio processing:", error, {
        hasMemoryBuffer: !!this.wasmMemoryBuffer,
        inputPtr: this.inputPtr,
        outputPtr: this.outputPtr,
      });
      return true;
    }
  }
}

registerProcessor("audio-decay-processor", AudioDecayProcessor);
