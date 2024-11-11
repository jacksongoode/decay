// New file: www/js/wasm-audio-processor.js
import { AUDIO_CONSTANTS } from "./audio-constants.js";
import init, { AudioProcessor } from "./wasm/decay_wasm.js";

export class WasmAudioProcessor {
  constructor() {
    this.audioContext = null;
    this.workletNode = null;
    this.wasmProcessor = null;
    this.wasmMemory = null;
    this.sourceNode = null;
  }

  setAudioContext(context) {
    this.audioContext = context;
  }

  async setupAudioProcessing(sourceNode) {
    try {
      this.sourceNode = sourceNode;

      await this.initializeWasm();

      // Load the worklet module first
      await this.audioContext.audioWorklet.addModule('/static/js/audio-decay-worklet.js');

      // Create and configure worklet node
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        "audio-decay-processor",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 2,
          channelCountMode: "explicit",
          channelInterpretation: "speakers",
        },
      );

      // Set up message handling
      this.workletNode.port.onmessage = (event) => {
        if (event.data.type === "requestWasmMemory") {
          this.sendWasmMemory();
        } else if (event.data.type === "processAudio") {
          const { offset, length } = event.data;
          this.wasmProcessor.process_audio(offset, length);
        }
      };

      // Connect the audio chain
      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);

      console.log("[WasmAudioProcessor] Audio chain connected");
    } catch (error) {
      console.error("[WasmAudioProcessor] Setup failed:", error);
      throw error;
    }
  }

  async sendWasmMemory() {
    if (!this.wasmMemory || !this.wasmProcessor) {
      throw new Error("WASM not initialized");
    }

    this.workletNode.port.postMessage({
      type: "init",
      memory: {
        buffer: this.wasmMemory.buffer,
        inputPtr: this.wasmProcessor.get_input_buffer_ptr(),
        outputPtr: this.wasmProcessor.get_output_buffer_ptr(),
      },
    });
  }

  async initializeWasm() {
    try {
      this.wasmMemory = new WebAssembly.Memory({
        initial: 256,
        maximum: 512,
        shared: true,
      });

      await init();
      this.wasmProcessor = new AudioProcessor();

      console.log("[WasmAudioProcessor] WASM initialized");
    } catch (error) {
      console.error("[WasmAudioProcessor] WASM initialization failed:", error);
      throw error;
    }
  }

  async cleanup() {
    try {
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }

      if (this.workletNode) {
        this.workletNode.disconnect();
        this.workletNode = null;
      }

      this.wasmProcessor = null;
      this.wasmMemory = null;

      console.log("[WasmAudioProcessor] Cleanup complete");
    } catch (error) {
      console.warn("[WasmAudioProcessor] Cleanup error:", error);
    }
  }
}

async function createSharedBuffer(size) {
  try {
    // Try SharedArrayBuffer first
    return new SharedArrayBuffer(size);
  } catch (e) {
    console.warn(
      "SharedArrayBuffer not available, falling back to ArrayBuffer",
    );
    // Fall back to regular ArrayBuffer
    return new ArrayBuffer(size);
  }
}
