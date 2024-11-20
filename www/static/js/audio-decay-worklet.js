// audio-decay-worklet.js
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

    try {
      if (!options?.processorOptions) {
        throw new Error("No processor options provided");
      }

      const { wasmMemory, inputPtr, outputPtr, constants } =
        options.processorOptions;

      // Validate required parameters
      if (!wasmMemory || !inputPtr || !outputPtr) {
        throw new Error("Missing required WASM memory parameters");
      }

      // Store constants from processor options
      this.bufferSize = constants.BUFFER_SIZE;
      this.channelCount = constants.CHANNEL_COUNT;

      // Initialize processor
      this.initialized = true;
      this.wasmMemoryBuffer = wasmMemory.buffer;
      this.inputPtr = inputPtr;
      this.outputPtr = outputPtr;

      // Create WASM memory views using constants
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
      if (!this.inputView || !this.outputView) {
        console.error("[AudioDecayProcessor] Views not initialized");
        return true;
      }

      const inputChannel = input[0];
      this.inputView.set(inputChannel);

      this.port.postMessage({
        type: "processBuffer",
        inputPtr: this.inputPtr,
        outputPtr: this.outputPtr,
        length: this.bufferSize,
      });

      const outputChannel = output[0];
      outputChannel.set(this.outputView);

      if (output[1]) {
        output[1].set(outputChannel);
      }

      return true;
    } catch (error) {
      console.error("[AudioDecayProcessor] Process error:", error);
      this.port.postMessage({ type: "error", error: error.message });
      return true;
    }
  }
}

registerProcessor("audio-decay-processor", AudioDecayProcessor);
