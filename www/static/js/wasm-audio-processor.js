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
    this.onProcessorEvent = null;
  }

  setAudioContext(context) {
    this.audioContext = context;
    if (this.audioContext.state !== "running") {
      console.warn(
        "[WasmAudioProcessor] AudioContext not running, waiting for user interaction",
      );
    }
  }

  async setupAudioProcessing(sourceNode) {
    try {
      this.sourceNode = sourceNode;
      console.log("[WasmAudioProcessor] Starting setup");

      // Initialize WASM first
      await this.initializeWasm();

      // Load and register the worklet
      const workletUrl = new URL(
        "/static/js/audio-decay-worklet.js",
        window.location.href,
      );
      console.log(
        "[WasmAudioProcessor] Loading worklet from:",
        workletUrl.href,
      );

      await this.audioContext.audioWorklet.addModule(workletUrl);
      console.log("[WasmAudioProcessor] Worklet module loaded");

      // Create worklet node with explicit options
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        "audio-decay-processor",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 2,
          processorOptions: {
            bufferSize: AUDIO_CONSTANTS.BUFFER_SIZE,
          },
        },
      );

      // Enhanced message handling
      this.workletNode.port.onmessage = (event) => {
        try {
          console.log("[WasmAudioProcessor] Received message:", event.data);

          if (event.data.type === "requestWasmMemory") {
            console.log("[WasmAudioProcessor] Sending WASM memory");
            this.sendWasmMemory();
          } else if (event.data.type === "processAudio") {
            // Process audio synchronously
            console.log("[WasmAudioProcessor] Processing audio...");

            // Process the audio with bit depth reduction
            this.wasmProcessor.set_bit_depth(8); // Start with 8-bit reduction
            this.wasmProcessor.process_audio(
              event.data.offset,
              event.data.length,
            );

            console.log("[WasmAudioProcessor] Audio processed");

            // Signal completion
            this.workletNode.port.postMessage({
              type: "processingComplete",
            });
          }
        } catch (error) {
          console.error("[WasmAudioProcessor] Processing error:", error);
        }
      };

      // Connect audio nodes
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
      // Create shared memory
      this.wasmMemory = new WebAssembly.Memory({
        initial: 256,
        maximum: 512,
        shared: true,
      });

      // Initialize WASM module
      const wasmModule = await import("./wasm/decay_wasm.js");
      await wasmModule.default({
        memory: this.wasmMemory,
      });

      // Create processor
      this.wasmProcessor = new wasmModule.AudioProcessor();

      // Verify memory setup
      const inputPtr = this.wasmProcessor.get_input_buffer_ptr();
      const outputPtr = this.wasmProcessor.get_output_buffer_ptr();

      console.log(
        "[WasmAudioProcessor] Memory setup - Input ptr:",
        inputPtr,
        "Output ptr:",
        outputPtr,
      );

      return true;
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

  async setupAudioChain() {
    try {
      // Create worklet node with explicit options
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        "audio-decay-processor",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 2,
          processorOptions: {
            bufferSize: AUDIO_CONSTANTS.BUFFER_SIZE,
          },
        },
      );

      // Debug connection states
      console.log("[WasmAudioProcessor] Source node:", this.sourceNode);
      console.log("[WasmAudioProcessor] Worklet node:", this.workletNode);

      // Connect the audio chain
      this.sourceNode.connect(this.workletNode);
      console.log("[WasmAudioProcessor] Source connected to worklet");

      this.workletNode.connect(this.audioContext.destination);
      console.log("[WasmAudioProcessor] Worklet connected to destination");

      console.log("[WasmAudioProcessor] Audio chain connected");
    } catch (error) {
      console.error("[WasmAudioProcessor] Audio chain setup failed:", error);
      throw error;
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
