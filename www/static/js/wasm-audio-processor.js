// New file: www/js/wasm-audio-processor.js
import init, { AudioProcessor } from "./wasm/decay_wasm.js";

export class WasmAudioProcessor {
  constructor() {
    this.audioContext = null;
    this.workletNode = null;
    this.wasmProcessor = null;
    this.sourceNode = null;
    this.wasmInitialized = false;
  }

  setAudioContext(context) {
    this.audioContext = context;
    console.log("Audio context set with sample rate:", context.sampleRate);
  }

  async setupAudioProcessing(stream) {
    try {
      if (!this.audioContext) {
        throw new Error("AudioContext must be set before setupAudioProcessing");
      }

      console.log(
        "Setting up audio processing with context sample rate:",
        this.audioContext.sampleRate,
      );

      // Create a new MediaStreamAudioSourceNode
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);

      // Initialize worklet if not already done
      if (!this.workletNode) {
        await this.initializeWorklet();
      }

      // Connect the nodes
      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);

      console.log("Audio processing setup complete");
    } catch (error) {
      console.error("Audio processing setup failed:", error);
      throw error;
    }
  }

  async initializeWasm() {
    if (!this.wasmInitialized) {
      // Initialize WASM with explicit memory configuration
      const memory = new WebAssembly.Memory({
        initial: 256, // Start with 16MB (256 pages * 64KB)
        maximum: 512, // Allow growth up to 32MB
        shared: false, // Non-shared memory for better compatibility
      });

      await init({
        env: { memory },
      });

      this.wasmProcessor = new AudioProcessor();

      // Verify WASM initialization
      if (!this.wasmProcessor) {
        throw new Error("WASM initialization failed - processor not created");
      }

      // Store memory reference
      this.wasmMemory = memory;
      this.wasmInitialized = true;

      console.log("WASM processor initialized with:", {
        inputPtr: this.wasmProcessor.get_input_buffer_ptr(),
        outputPtr: this.wasmProcessor.get_output_buffer_ptr(),
        memoryBuffer: this.wasmMemory.buffer.byteLength,
      });
    }
    return this.wasmProcessor;
  }

  async initializeWorklet() {
    try {
      // Create a promise we can use to coordinate WASM initialization
      this.wasmInitPromise = this.initializeWasm();

      // Wait for WASM to be fully initialized
      const wasmProcessor = await this.wasmInitPromise;

      // Store WASM instance reference
      this.wasmProcessor = wasmProcessor;

      // Now initialize the worklet
      const workletUrl = new URL("./audio-decay-worklet.js", import.meta.url);
      await this.audioContext.audioWorklet.addModule(workletUrl);

      // Create worklet with guaranteed WASM initialization
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        "audio-decay-processor",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 2,
          processorOptions: {
            // Ensure we're using the latest memory references
            wasmMemoryBuffer: this.wasmMemory.buffer,
            inputPtr: this.wasmProcessor.get_input_buffer_ptr(),
            outputPtr: this.wasmProcessor.get_output_buffer_ptr(),
          },
        },
      );

      // Implement a more robust message handling system
      this.workletNode.port.onmessage = async (event) => {
        switch (event.data.type) {
          case "requestWasm":
            try {
              if (!this.wasmProcessor) {
                await this.wasmInitPromise;
              }

              // Create shared buffer
              const sharedBuffer = new SharedArrayBuffer(
                this.wasmMemory.buffer.byteLength,
              );

              // Copy the WASM memory into our shared buffer
              const sourceView = new Uint8Array(this.wasmMemory.buffer);
              const targetView = new Uint8Array(sharedBuffer);
              targetView.set(sourceView);

              // Send the shared buffer to the worklet WITHOUT including it in transfer list
              this.workletNode.port.postMessage({
                type: "init",
                memory: {
                  buffer: sharedBuffer,
                  inputPtr: this.wasmProcessor.get_input_buffer_ptr(),
                  outputPtr: this.wasmProcessor.get_output_buffer_ptr(),
                  sampleRate: this.audioContext.sampleRate,
                },
              }); // Remove the transfer list

              console.log("Sent shared buffer to worklet:", {
                bufferSize: sharedBuffer.byteLength,
                inputPtr: this.wasmProcessor.get_input_buffer_ptr(),
                outputPtr: this.wasmProcessor.get_output_buffer_ptr(),
              });
            } catch (err) {
              console.error("Failed to send memory to worklet:", err);
              throw err;
            }
            break;

          case "processAudio":
            try {
              // Process the audio using WASM
              if (this.wasmProcessor) {
                this.wasmProcessor.process_audio(event.data.length);
              }
            } catch (err) {
              console.error("WASM audio processing failed:", err);
            }
            break;

          case "processorReady":
            console.log("AudioWorklet processor is ready");
            break;

          case "error":
            console.error("AudioWorklet processor error:", event.data.error);
            break;
        }
      };

      // Add error handling for the worklet node
      this.workletNode.onprocessorerror = (err) => {
        console.error("AudioWorklet processor error:", err);
        // Attempt recovery
        this.reinitializeProcessor();
      };

      return this.workletNode;
    } catch (error) {
      console.error("Failed to initialize worklet:", error);
      throw error;
    }
  }

  // Add a recovery method
  async reinitializeProcessor() {
    try {
      // Clean up existing processor
      if (this.workletNode) {
        this.workletNode.disconnect();
        this.workletNode = null;
      }

      // Re-initialize WASM
      this.wasmInitialized = false;
      await this.initializeWasm();

      // Recreate worklet
      await this.initializeWorklet();

      // Reconnect audio nodes if needed
      if (this.sourceNode) {
        this.sourceNode.connect(this.workletNode);
        this.workletNode.connect(this.audioContext.destination);
      }
    } catch (err) {
      console.error("Failed to recover processor:", err);
      throw err;
    }
  }

  adjustBitrate(targetBitrate) {
    if (!this.wasmProcessor) {
      console.warn("WASM processor not initialized");
      return targetBitrate;
    }
    return this.wasmProcessor.adjust_bitrate(targetBitrate);
  }

  async cleanup() {
    if (this._cleanupPromise) return this._cleanupPromise;

    this._cleanupPromise = (async () => {
      try {
        // Cancel any pending initialization
        this.wasmInitPromise = null;

        if (this.workletNode) {
          this.workletNode.port.onmessage = null;
          this.workletNode.onprocessorerror = null;
          this.workletNode.disconnect();
          this.workletNode = null;
        }
        if (this.sourceNode) {
          this.sourceNode.disconnect();
          this.sourceNode = null;
        }

        // Clear WASM state
        this.wasmProcessor = null;
        this.wasmInitialized = false;
      } catch (err) {
        console.warn("WasmAudioProcessor cleanup error:", err);
      }
    })();

    return this._cleanupPromise;
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
