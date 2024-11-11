import { WasmAudioProcessor } from "./wasm-audio-processor.js";

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

      // Initialize audio context
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext ||
          window.webkitAudioContext)();
        await this.audioContext.resume();
      }

      // Create MediaStream from track
      const remoteStream = new MediaStream([track]);
      const source = this.audioContext.createMediaStreamSource(remoteStream);

      // Initialize audio processor
      this.audioProcessor = new WasmAudioProcessor();
      this.audioProcessor.setAudioContext(this.audioContext);
      await this.audioProcessor.setupAudioProcessing(source);

      // Start monitoring audio levels
      this.startInputMonitoring();

      console.log("[AudioStreamManager] Remote track handling complete");
    } catch (error) {
      console.error(
        "[AudioStreamManager] Failed to handle remote track:",
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
      // Fetch TURN credentials dynamically
      const response = await fetch(
        `https://audiodecay.metered.live/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`,
      );

      let iceServers = [];

      if (response.ok) {
        iceServers = await response.json();
      } else {
        // Fallback to static configuration
        iceServers = [
          { urls: "stun:stun.l.google.com:19302" },
          {
            urls: "turn:global.relay.metered.ca:80",
            username: process.env.TURN_USERNAME,
            credential: process.env.TURN_CREDENTIAL,
          },
          {
            urls: "turn:global.relay.metered.ca:443",
            username: process.env.TURN_USERNAME,
            credential: process.env.TURN_CREDENTIAL,
          },
        ];
      }

      this.peerConnection = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: 10,
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
        sdpSemantics: "unified-plan",
        iceTransportPolicy: "all",
      });

      // Reduce ICE candidate logging
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          onIceCandidate(event);
        }
      };

      // Only log state changes if they indicate a problem
      this.peerConnection.oniceconnectionstatechange = () => {
        const state = this.peerConnection.iceConnectionState;
        if (state === "failed" || state === "disconnected") {
          console.log("ICE Connection state:", state);
        }
      };

      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection.connectionState;
        if (state === "failed" || state === "disconnected") {
          console.log("Connection state:", state);
          this.cleanup();
        }
      };

      this.peerConnection.ontrack = async (event) => {
        console.log("[AudioStreamManager] Track received:", event.track.kind);
        if (event.track.kind === "audio") {
          await this.handleRemoteTrack(event.track, event.streams[0]);
        }
      };

      const audioTrack = await this.getAudioTrackWithFallback();
      this.peerConnection.addTrack(audioTrack);

      return this.peerConnection;
    } catch (error) {
      console.error("PeerConnection failed:", error);
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
