class AudioDecayProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.initialized = false;
    this.port.onmessage = this.handleMessage.bind(this);
    this.port.postMessage({ type: "requestWasmMemory" });
  }

  handleMessage(event) {
    if (event.data.type === "init") {
      this.wasmMemoryBuffer = event.data.memory.buffer;
      this.inputPtr = event.data.memory.inputPtr;
      this.outputPtr = event.data.memory.outputPtr;
      this.initialized = true;
      console.log("[AudioDecayProcessor] WASM memory initialized");
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input?.[0] || !output?.[0] || !this.initialized) {
      return true;
    }

    try {
      for (let channel = 0; channel < input.length; channel++) {
        const inputChannel = input[channel];
        const outputChannel = output[channel];

        // Copy input to WASM memory
        const inputBuffer = new Float32Array(
          this.wasmMemoryBuffer,
          this.inputPtr + channel * inputChannel.length * 4,
          inputChannel.length,
        );
        inputBuffer.set(inputChannel);

        // Request processing synchronously
        this.port.postMessage({
          type: "processAudio",
          channel: channel,
          offset: channel * inputChannel.length,
          length: inputChannel.length,
        });

        // Copy from WASM memory to output
        const outputBuffer = new Float32Array(
          this.wasmMemoryBuffer,
          this.outputPtr + channel * inputChannel.length * 4,
          inputChannel.length,
        );
        outputChannel.set(outputBuffer);
      }
    } catch (error) {
      console.error("[AudioDecayProcessor] Processing error:", error);
    }

    return true;
  }
}

registerProcessor("audio-decay-processor", AudioDecayProcessor);
