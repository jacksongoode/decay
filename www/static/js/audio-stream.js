import { isLocalhost } from "./utils.js";
import { AUDIO_CONSTANTS } from "./audio-constants.js";

async function initWasmProcessor() {
  try {
    // Import both JS and Wasm files
    const wasmModule = await import("/static/wasm/decay_wasm.js");
    const wasmInstance = await fetch("/static/wasm/decay_wasm_bg.wasm");

    if (!wasmInstance.ok) {
      throw new Error(`Failed to load WASM: ${wasmInstance.statusText}`);
    }

    const wasmBytes = await wasmInstance.arrayBuffer();

    // Initialize the module with proper memory
    await wasmModule.default({
      env: {
        memory: new WebAssembly.Memory({
          initial: AUDIO_CONSTANTS.WASM_MEMORY.INITIAL,
          maximum: AUDIO_CONSTANTS.WASM_MEMORY.MAXIMUM,
          shared: true,
        }),
      },
      buffer: wasmBytes,
    });

    const processor = new wasmModule.AudioProcessor();
    console.log("[WasmAudioProcessor] WASM module initialized successfully");
    return processor;
  } catch (error) {
    console.error("[WasmAudioProcessor] Failed to initialize WASM:", error);
    throw error;
  }
}

class WasmAudioProcessor {
  constructor() {
    this.audioContext = null;
    this.workletNode = null;
    this.wasmProcessor = null;
    this.wasmMemory = null;
    this.sourceNode = null;
  }

  setAudioContext(context) {
    if (!context) {
      throw new Error("AudioContext is required");
    }
    this.audioContext = context;
    console.log("[WasmAudioProcessor] Audio context set:", context.state);
  }

  async setupAudioProcessing(sourceNode) {
    try {
      // Double-check audio context is set and running
      if (!this.audioContext) {
        throw new Error("AudioContext not initialized");
      }

      if (this.audioContext.state !== "running") {
        await this.audioContext.resume();
      }

      this.sourceNode = sourceNode;
      console.log("[WasmAudioProcessor] Starting setup");

      // Initialize WASM memory using constants
      this.wasmMemory = new WebAssembly.Memory({
        initial: AUDIO_CONSTANTS.WASM_MEMORY.INITIAL,
        maximum: AUDIO_CONSTANTS.WASM_MEMORY.MAXIMUM,
        shared: true,
      });

      // Load worklet first
      const workletUrl = new URL(
        "/static/js/audio-decay-worklet.js",
        window.location.href,
      );
      await this.audioContext.audioWorklet.addModule(workletUrl);

      // Then initialize WASM
      if (!this.wasmProcessor) {
        this.wasmProcessor = await initWasmProcessor();
      }

      // Create worklet node
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        "audio-decay-processor",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: AUDIO_CONSTANTS.CHANNEL_COUNT,
          processorOptions: {
            wasmMemory: this.wasmMemory,
            inputPtr: this.wasmProcessor.get_input_buffer_ptr(),
            outputPtr: this.wasmProcessor.get_output_buffer_ptr(),
            constants: AUDIO_CONSTANTS,
          },
        },
      );

      // Connect nodes
      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);

      console.log("[WasmAudioProcessor] Setup complete");
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
        this.workletNode.port.onmessage = null;
        this.workletNode.disconnect();
        this.workletNode = null;
      }

      this.wasmProcessor = null;
      this.wasmMemory = null;
    } catch (error) {
      console.warn("[WasmAudioProcessor] Cleanup error:", error);
    }
  }
}

export class AudioStreamManager {
  constructor(connectionState) {
    this.audioContext = null;
    this.wasmProcessor = null;
    this.connectionState = connectionState;
    this.isProcessingAudio = false;
    this.analyser = null;
  }

  async initializeAudio() {
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext({
          latencyHint: AUDIO_CONSTANTS.LATENCY_HINT,
        });

        // Create and initialize the processor after context is created
        this.wasmProcessor = new WasmAudioProcessor();
        this.wasmProcessor.setAudioContext(this.audioContext);

        console.log("[AudioStreamManager] Audio context initialized:", {
          state: this.audioContext.state,
        });
      }

      if (this.audioContext.state !== "running") {
        await this.audioContext.resume();
      }

      console.log(
        "[AudioStreamManager] Audio context state:",
        this.audioContext.state,
      );
    } catch (error) {
      console.error("[AudioStreamManager] Audio initialization failed:", error);
      throw error;
    }
  }

  async handleRemoteTrack(track) {
    try {
      // Ensure audio is initialized first
      await this.initializeAudio();

      // Create media stream source only after audio context is ready
      const sourceNode = this.audioContext.createMediaStreamSource(
        new MediaStream([track]),
      );
      console.log("[AudioStreamManager] Media stream source created");

      // Pass both the context and source node to setup
      await this.wasmProcessor.setupAudioProcessing(sourceNode);
    } catch (error) {
      console.error(
        "[AudioStreamManager] Remote track handling failed:",
        error,
      );
      throw error;
    }
  }

  startInputMonitoring() {
    if (!this.audioContext || !this.analyser) return;

    const dataArray = new Float32Array(this.analyser.frequencyBinCount);
    const checkLevel = () => {
      if (!this.isProcessingAudio) return;

      this.analyser.getFloatTimeDomainData(dataArray);
      const level = Math.max(...dataArray.map(Math.abs));

      if (level === 0) {
        console.warn(
          "[AudioStreamManager] Receiving silence - check input source",
        );
      } else {
        console.log(`[AudioStreamManager] Input level: ${level.toFixed(4)}`);
      }

      requestAnimationFrame(checkLevel);
    };

    this.isProcessingAudio = true;
    checkLevel();
  }

  startContextMonitoring() {
    const checkContext = () => {
      if (!this.audioContext || !this.isProcessingAudio) return;

      if (this.audioContext.state === "suspended") {
        this.audioContext.resume().catch((error) => {
          console.warn("[AudioStreamManager] Failed to resume context:", error);
        });
      }
    };

    // Check every second
    setInterval(checkContext, 1000);
  }

  async createPeerConnection(onIceCandidate) {
    try {
      const isDevelopment = isLocalhost(window.location.hostname);
      const baseUrl = isDevelopment
        ? `https://${window.location.host}`
        : "https://audio-decay-worker.jacksongoode.workers.dev";

      // Get TURN credentials from appropriate endpoint
      const response = await fetch(`${baseUrl}/api/turn-credentials`);
      const iceServers = await response.json();

      const config = {
        iceServers: [
          ...iceServers.iceServers,
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
        sdpSemantics: "unified-plan",
        iceTransportPolicy: "all",
      };

      this.peerConnection = new RTCPeerConnection(config);
      console.log(
        "[AudioStreamManager] PeerConnection created with config:",
        config,
      );

      // Add track handling
      this.peerConnection.ontrack = async (event) => {
        console.log("[AudioStreamManager] Track received:", event.track.kind);
        if (event.track.kind === "audio") {
          await this.handleRemoteTrack(event.track, event.streams[0]);
        }
      };

      // Add connection state logging
      this.peerConnection.onconnectionstatechange = () => {
        console.log(
          "[AudioStreamManager] Connection state:",
          this.peerConnection.connectionState,
        );
      };

      this.peerConnection.oniceconnectionstatechange = () => {
        console.log(
          "[AudioStreamManager] ICE state:",
          this.peerConnection.iceConnectionState,
        );
      };

      // Add audio track
      const audioTrack = await this.getAudioTrackWithFallback();
      if (audioTrack) {
        this.peerConnection.addTrack(audioTrack);
      }

      // Reduce ICE candidate logging
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          onIceCandidate(event);
        }
      };

      return this.peerConnection;
    } catch (error) {
      console.error(
        "[AudioStreamManager] Failed to create peer connection:",
        error,
      );
      throw error;
    }
  }

  // Add fallback method for getting audio tracks
  async getAudioTrackWithFallback() {
    const constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
        // Safari and some mobile browsers need these
        channelCount: { ideal: 2, min: 1 },
      },
    };

    try {
      // Modern API
      if (navigator.mediaDevices?.getUserMedia) {
        return (
          await navigator.mediaDevices.getUserMedia(constraints)
        ).getAudioTracks()[0];
      }

      // Legacy API fallback
      const getUserMedia =
        navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia;

      if (!getUserMedia) {
        throw new Error("Media devices not supported");
      }

      return new Promise((resolve, reject) => {
        getUserMedia.call(
          navigator,
          constraints,
          (stream) => resolve(stream.getAudioTracks()[0]),
          (error) => reject(error),
        );
      });
    } catch (error) {
      console.error("Failed to get audio track:", error);
      throw error;
    }
  }

  async cleanup() {
    try {
      this.isProcessingAudio = false;

      if (this.wasmProcessor) {
        await this.wasmProcessor.cleanup();
        this.wasmProcessor = null;
      }

      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }

      if (this.audioContext) {
        await this.audioContext.close();
        this.audioContext = null;
      }

      this.analyser = null;
    } catch (e) {
      console.warn("[AudioStreamManager] Cleanup error:", e);
    }
  }
}
