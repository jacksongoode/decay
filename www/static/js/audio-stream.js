import { WasmAudioProcessor } from "./wasm-audio-processor.js";
import { isLocalhost } from "./utils.js";

export class AudioStreamManager {
  constructor(connectionState) {
    this.stream = null;
    this.peerConnection = null;
    this.connectionState = connectionState;
    this.audioContext = null;
    this.audioProcessor = null;
    this.isProcessingAudio = false;
    this.analyser = null;
  }

  async handleRemoteTrack(track, stream) {
    try {
      console.log("[AudioStreamManager] Starting remote track handling");
      console.log("[AudioStreamManager] Track kind:", track.kind);
      console.log("[AudioStreamManager] Track state:", track.readyState);

      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext ||
          window.webkitAudioContext)();
        await this.audioContext.resume();
        console.log(
          "[AudioStreamManager] Audio context created:",
          this.audioContext.state,
        );
      }

      const remoteStream = new MediaStream([track]);
      const source = this.audioContext.createMediaStreamSource(remoteStream);
      console.log("[AudioStreamManager] Media stream source created");

      this.audioProcessor = new WasmAudioProcessor();
      this.audioProcessor.setAudioContext(this.audioContext);

      // Add debug logging for setup stages
      this.audioProcessor.onProcessorEvent = (event) => {
        console.log("[AudioStreamManager] Processor event:", event);
      };

      await this.audioProcessor.setupAudioProcessing(source);
      console.log("[AudioStreamManager] Audio processing setup complete");
    } catch (error) {
      console.error(
        "[AudioStreamManager] Remote track handling failed:",
        error,
      );
      throw error;
    }
  }

  startInputMonitoring() {
    if (!this.audioContext || !this.audioProcessor) return;

    // Create analyzer for monitoring
    const analyzer = this.audioContext.createAnalyser();
    analyzer.fftSize = 2048;

    // Connect analyzer in parallel to processing chain
    this.audioProcessor.sourceNode.connect(analyzer);

    const dataArray = new Float32Array(analyzer.frequencyBinCount);

    const checkLevel = () => {
      analyzer.getFloatTimeDomainData(dataArray);
      const level = Math.max(...dataArray.map(Math.abs));
      console.log(`[AudioStreamManager] Input level: ${level.toFixed(4)}`);

      if (this.isProcessingAudio) {
        requestAnimationFrame(checkLevel);
      }
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

  async initializeAudio() {
    if (this.audioContext) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;

      if (!AudioContext) {
        throw new Error("AudioContext not supported");
      }

      this.audioContext = new AudioContext({
        latencyHint: "interactive",
      });

      this.audioContext.onstatechange = () => {
        console.log(
          "[AudioStreamManager] Audio context state:",
          this.audioContext.state,
        );
      };

      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      console.log("[AudioStreamManager] Audio context initialized:", {
        state: this.audioContext.state,
        sampleRate: this.audioContext.sampleRate,
      });
    } catch (error) {
      console.error("[AudioStreamManager] Failed to initialize audio:", error);
      throw error;
    }
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

      if (this.audioProcessor) {
        await this.audioProcessor.cleanup();
        this.audioProcessor = null;
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
