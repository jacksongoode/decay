// audio-decay-worklet.js
const RENDER_QUANTUM_FRAMES = 128;
const PROCESSING_QUANTUM_FRAMES = 128; // Minimum frames needed for processing

class AudioDecayProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "pitch",
        defaultValue: 0.5,
        minValue: 0.25,
        maxValue: 2.0,
      },
    ];
  }

  constructor(options) {
    super();

    this.initialized = false;
    this.bufferSize = 128;
    this.sampleRate = 48000;

    try {
      if (!options?.processorOptions) {
        throw new Error("No processor options provided");
      }

      const { wasmMemory, inputPtr, outputPtr } = options.processorOptions;

      // Initialize processor
      this.initialized = true;
      this.wasmMemoryBuffer = wasmMemory.buffer;
      this.inputPtr = inputPtr;
      this.outputPtr = outputPtr;

      // Create WASM memory views
      this.inputView = new Float32Array(
        this.wasmMemoryBuffer,
        this.inputPtr,
        this.bufferSize,
      );
      this.outputView = new Float32Array(
        this.wasmMemoryBuffer,
        this.outputPtr,
        this.bufferSize,
      );

      console.log(
        "[AudioDecayProcessor] Initialized with buffer size:",
        this.bufferSize,
      );
    } catch (error) {
      console.error("[AudioDecayProcessor] Initialization failed:", error);
      throw error;
    }
  }

  process(inputs, outputs, parameters) {
    if (!this.initialized) return true;

    const input = inputs[0];
    const output = outputs[0];

    if (!input?.[0] || !output?.[0]) {
      return true;
    }

    try {
      // Copy input to WASM buffer
      const inputChannel = input[0];
      this.inputView.set(inputChannel);

      // Process audio directly instead of posting message
      // This should be synchronized with WASM
      this.port.postMessage({
        type: "processBuffer",
        inputPtr: this.inputPtr,
        outputPtr: this.outputPtr,
        length: this.bufferSize,
      });

      // Copy processed output back
      const outputChannel = output[0];
      outputChannel.set(this.outputView);

      // Copy to second channel if stereo
      if (output[1]) {
        output[1].set(outputChannel);
      }

      return true;
    } catch (error) {
      console.error("[AudioDecayProcessor] Process error:", error);
      return true;
    }
  }
}

registerProcessor("audio-decay-processor", AudioDecayProcessor);
