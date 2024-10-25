// New file: www/js/wasm-audio-processor.js
import init, { AudioProcessor } from "./wasm/decay_wasm.js";

export class WasmAudioProcessor {
  constructor() {
    this.processor = null;
    this.initialized = false;
  }

  async initialize() {
    if (!this.initialized) {
      await init();
      this.processor = new AudioProcessor();
      this.initialized = true;
    }
  }

  adjustBitrate(targetBitrate) {
    if (!this.initialized) {
      throw new Error("WASM AudioProcessor not initialized");
    }
    return this.processor.adjust_bitrate(targetBitrate);
  }
}
