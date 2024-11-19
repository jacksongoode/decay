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

      // Initialize WASM memory
      this.wasmMemory = new WebAssembly.Memory({
        initial: 256,
        maximum: 512,
        shared: true,
      });

      // Load and register the worklet
      const workletUrl = new URL(
        "/static/js/audio-decay-worklet.js",
        window.location.href,
      );
      await this.audioContext.audioWorklet.addModule(workletUrl);

      // Create worklet node
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        "audio-decay-processor",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 2,
          processorOptions: {
            wasmMemory: this.wasmMemory,
            inputPtr: this.wasmProcessor.get_input_buffer_ptr(),
            outputPtr: this.wasmProcessor.get_output_buffer_ptr(),
          },
        },
      );

      // Set up message handling
      this.workletNode.port.onmessage = (event) => {
        if (event.data.type === "processBuffer") {
          this.wasmProcessor.process_audio(0, event.data.length);
        }
      };

      // Connect audio nodes
      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);

      console.log("[WasmAudioProcessor] Audio processing setup complete");
    } catch (error) {
      console.error("[WasmAudioProcessor] Setup failed:", error);
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
