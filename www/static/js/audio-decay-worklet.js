class AudioDecayProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.initialized = false;
    this.bufferSize = 128;
    this.processingComplete = false;
    this.lastProcessedBuffer = new Float32Array(this.bufferSize);

    this.port.onmessage = (event) => {
      if (event.data.type === "init") {
        this.wasmMemoryBuffer = event.data.memory.buffer;
        this.inputPtr = event.data.memory.inputPtr;
        this.outputPtr = event.data.memory.outputPtr;
        this.initialized = true;
        console.log("[AudioDecayProcessor] WASM memory initialized");
      } else if (event.data.type === "processingComplete") {
        const processedView = new Float32Array(
          this.wasmMemoryBuffer,
          this.outputPtr,
          this.bufferSize,
        );
        this.lastProcessedBuffer.set(processedView);
        this.processingComplete = true;
      }
    };

    this.port.postMessage({
      type: "requestWasmMemory",
      bufferSize: this.bufferSize,
    });
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input?.[0] || !output?.[0] || !this.initialized) {
      return true;
    }

    try {
      for (let channelIndex = 0; channelIndex < input.length; channelIndex++) {
        const inputChannel = input[channelIndex];
        const outputChannel = output[channelIndex];

        const inputView = new Float32Array(
          this.wasmMemoryBuffer,
          this.inputPtr +
            channelIndex * this.bufferSize * Float32Array.BYTES_PER_ELEMENT,
          inputChannel.length,
        );
        inputView.set(inputChannel);

        this.port.postMessage({
          type: "processAudio",
          offset: channelIndex * this.bufferSize,
          length: inputChannel.length,
        });

        if (this.processingComplete) {
          outputChannel.set(this.lastProcessedBuffer);
        } else {
          outputChannel.fill(0);
        }
      }

      return true;
    } catch (error) {
      console.error("[AudioDecayProcessor] Process error:", error);
      return true;
    }
  }
}

registerProcessor("audio-decay-processor", AudioDecayProcessor);
