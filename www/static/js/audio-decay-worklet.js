class AudioDecayProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.initialized = false;
    this.bufferSize = 128;

    this.port.onmessage = (event) => {
      if (event.data.type === "init") {
        this.wasmMemoryBuffer = event.data.memory.buffer;
        this.inputPtr = event.data.memory.inputPtr;
        this.outputPtr = event.data.memory.outputPtr;
        this.initialized = true;
        console.log("[AudioDecayProcessor] WASM memory initialized");
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

        const rawInputLevel = Math.max(...inputChannel.map(Math.abs));
        if (rawInputLevel > 0.01) {
          console.log("[AudioDecayProcessor] Raw input level:", rawInputLevel);
        }

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

        const outputView = new Float32Array(
          this.wasmMemoryBuffer,
          this.outputPtr +
            channelIndex * this.bufferSize * Float32Array.BYTES_PER_ELEMENT,
          inputChannel.length,
        );
        outputChannel.set(outputView);

        const outputLevel = Math.max(...outputChannel.map(Math.abs));
        if (outputLevel > 0.01) {
          console.log("[AudioDecayProcessor] Output level:", outputLevel);
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
