import { WasmAudioProcessor } from "./wasm-audio-processor.js";

export class AudioStreamManager {
  constructor(connectionState) {
    this.stream = null;
    this.peerConnection = null;
    this.connectionState = connectionState;
    this.bitrateControl = {
      min: 2, // 2 kbps minimum
      max: 128, // 128 kbps maximum
      current: 128,
    };
    this.startTime = null;
    this.updateInterval = null;
    this.remoteAudio = new Audio();
    this.remoteAudio.autoplay = true;
    this.remoteAudio.playsInline = true; // Important for iOS
    this.audioContext = null;
    this.audioProcessor = null;
    this.audioInitialized = false;
    this.isCleaningUp = false;
    this.setupStateHandlers(connectionState);
    this.healthCheckInterval = null;
    this.startHealthCheck();
    this.isProcessingAudio = false;
  }

  setupStateHandlers(connectionState) {
    connectionState.on("connectionFailed", () => this.cleanup());
    connectionState.on("stateChange", ({ newState }) => {
      if (newState === connectionState.states.FAILED) {
        this.cleanup();
      }
    });
  }

  async initializeStream() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Set specific audio parameters
          autoGainControl: true,
          channelCount: 2,
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 48000, // Explicitly request 48kHz
          sampleSize: 16,
        },
        video: false,
      });
      return this.stream;
    } catch (error) {
      console.error("Microphone access failed:", error);
      throw error;
    }
  }

  async createPeerConnection(onIceCandidate) {
    try {
      if (!this.stream) {
        await this.initializeStream();
      }

      // Create peer connection with basic STUN configuration
      this.peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      // Add local audio track
      this.stream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, this.stream);
      });

      // Connection state monitoring
      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection.connectionState;
        console.log("Connection state:", state);

        switch (state) {
          case "connecting":
            this.connectionState.setState(
              this.connectionState.states.CONNECTING,
            );
            break;
          case "connected":
            this.connectionState.setState(
              this.connectionState.states.CONNECTED,
            );
            this.startAudioDecay();
            break;
          case "disconnected":
          case "failed":
          case "closed":
            this.cleanup();
            break;
        }
      };

      // ICE connection state monitoring
      this.peerConnection.oniceconnectionstatechange = () => {
        const state = this.peerConnection.iceConnectionState;
        console.log("ICE connection state:", state);

        if (state === "failed") {
          this.connectionState.setState(this.connectionState.states.FAILED);
          this.cleanup();
        }
      };

      this.peerConnection.onicecandidate = onIceCandidate;

      // Add ontrack handler to verify audio reception
      this.peerConnection.ontrack = (event) => {
        console.log("Received remote track:", event.track.kind);
        this.setupRemoteTrack(event.track, event.streams[0]);
      };

      // Verify local audio is being sent
      const audioTracks = this.stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error("No local audio track available");
      }

      // Monitor audio track state
      audioTracks.forEach((track) => {
        track.onended = () => {
          console.error("Local audio track ended unexpectedly");
          this.cleanup();
        };
        track.onmute = () => {
          console.warn("Local audio track muted");
        };
        track.onunmute = () => {
          console.log("Local audio track unmuted");
        };
      });

      return this.peerConnection;
    } catch (error) {
      console.error("PeerConnection failed:", error);
      this.connectionState.setState(this.connectionState.states.FAILED);
      throw error;
    }
  }

  startAudioDecay() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.startTime = Date.now();
    this.isProcessingAudio = true;

    this.updateInterval = setInterval(() => {
      if (!this.isProcessingAudio) return;

      const elapsedTime = (Date.now() - this.startTime) / 1000;
      this.updateBitrate(elapsedTime);
    }, 500);
  }

  updateBitrate(elapsedTime) {
    if (!this.isProcessingAudio) return;

    // Much slower decay factor (closer to 1.0)
    // Original was 0.92, new value makes decay take about 1 minute
    const decayFactor = 0.99;

    // Calculate new bitrate using decay formula
    this.bitrateControl.current = Math.max(
      this.bitrateControl.min,
      Math.min(
        this.bitrateControl.max,
        this.bitrateControl.current * decayFactor,
      ),
    );

    // Alternative linear decay approach:
    // const totalDecayTime = 60; // 60 seconds
    // const decayRate = (this.bitrateControl.max - this.bitrateControl.min) / totalDecayTime;
    // this.bitrateControl.current = Math.max(
    //   this.bitrateControl.min,
    //   this.bitrateControl.max - (decayRate * elapsedTime)
    // );

    // Update connection state with new stats
    if (this.connectionState) {
      this.connectionState.updateStats({
        bitrate: this.bitrateControl.current,
        elapsedTime: elapsedTime,
      });
    }
  }

  async initializeAudio() {
    if (this.audioInitialized) return;

    try {
      // Create a default AudioContext without specifying sample rate
      this.audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();

      console.log(
        `System audio context created with sample rate: ${this.audioContext.sampleRate}`,
      );

      // Create the processor with the same context
      if (!this.audioProcessor) {
        this.audioProcessor = new WasmAudioProcessor();
        this.audioProcessor.setAudioContext(this.audioContext);
      }

      this.audioInitialized = true;
      return this.audioContext;
    } catch (error) {
      console.error("Failed to initialize audio:", error);
      throw error;
    }
  }

  async setupRemoteTrack(track, stream) {
    if (track.kind !== "audio") return;

    try {
      await this.initializeAudio();
      await this.audioProcessor.setupAudioProcessing(stream);

      console.log("Remote track setup complete");
    } catch (err) {
      console.error("Audio setup failed:", err);
      await this.cleanup();
      throw err;
    }
  }

  startHealthCheck() {
    this.healthCheckInterval = setInterval(() => {
      if (!this.peerConnection || !this.isProcessingAudio) return;

      this.peerConnection.getStats().then((stats) => {
        let hasActiveAudio = false;
        stats.forEach((report) => {
          if (report.type === "inbound-rtp" && report.kind === "audio") {
            hasActiveAudio = report.packetsReceived > 0;
          }
        });

        if (this.isProcessingAudio && !hasActiveAudio) {
          console.warn("No audio packets detected");
          this.cleanup();
          this.connectionState?.setState(this.connectionState.states.FAILED);
        }
      });
    }, 2000);
  }

  async cleanup() {
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;

    try {
      if (this.audioProcessor) {
        await this.audioProcessor.cleanup();
      }
      if (this.audioContext?.state !== "closed") {
        await this.audioContext?.close();
      }
    } catch (e) {
      console.warn("Cleanup error:", e);
    } finally {
      this.audioContext = null;
      this.audioInitialized = false;
      this.isCleaningUp = false;
    }
  }
}
