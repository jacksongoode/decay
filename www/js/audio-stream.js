export class AudioStreamManager {
  constructor(connectionState) {
    this.stream = null;
    this.peerConnection = null;
    this.connectionState = connectionState;
    this.bitrateControl = {
      min: 8, // 8 kbps minimum
      max: 128, // 128 kbps maximum
      current: 128,
    };
    this.startTime = null;
    this.updateInterval = null;
    this.remoteAudio = new Audio();
    this.remoteAudio.autoplay = true;
    this.remoteAudio.playsInline = true; // Important for iOS
    this.audioContext = null;
    this.audioInitialized = false;
    this.setupStateHandlers(connectionState);
  }

  setupStateHandlers(connectionState) {
    connectionState.on("connectionFailed", () => this.cleanup());
    connectionState.on("stateChange", ({ newState }) => {
      if (newState === connectionState.states.CONNECTED) {
        this.startAudioDecay();
      }
    });
  }

  async initializeStream() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
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
    this.startTime = Date.now();
    this.bitrateControl.current = this.bitrateControl.max;

    // Update bitrate every second
    this.updateInterval = setInterval(() => {
      const elapsedSeconds = (Date.now() - this.startTime) / 1000;
      const decayFactor = Math.exp(-elapsedSeconds / 30); // 30-second decay constant

      this.bitrateControl.current = Math.max(
        this.bitrateControl.min,
        this.bitrateControl.max * decayFactor,
      );

      this.updateBitrate();
    }, 1000);

    // Initial bitrate update
    this.updateBitrate();
  }

  async updateBitrate() {
    const sender = this.peerConnection
      ?.getSenders()
      .find((s) => s.track?.kind === "audio");

    if (!sender) return;

    try {
      const params = sender.getParameters();
      if (!params.encodings) {
        params.encodings = [{}];
      }

      params.encodings[0].maxBitrate = this.bitrateControl.current * 1000;
      await sender.setParameters(params);

      this.connectionState.updateState({
        currentBitrate: this.bitrateControl.current,
        elapsedTime: Math.floor((Date.now() - this.startTime) / 1000),
      });
    } catch (error) {
      console.warn("Failed to update bitrate:", error);
    }
  }

  async initializeAudio() {
    if (this.audioInitialized) return;

    // Create AudioContext on user gesture
    this.audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();

    // Resume audio context (needed for mobile)
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    this.audioInitialized = true;
  }

  setupRemoteTrack(track, stream) {
    console.log("Setting up remote track:", track.kind);

    if (track.kind === "audio") {
      this.remoteAudio.srcObject = stream;

      const playAudio = async () => {
        try {
          await this.initializeAudio();
          await this.remoteAudio.play();
        } catch (err) {
          console.error("Audio playback failed:", err);

          // Handle mobile autoplay restriction
          const resumeAudio = async () => {
            try {
              await this.initializeAudio();
              await this.remoteAudio.play();
              document.removeEventListener("touchstart", resumeAudio);
              document.removeEventListener("click", resumeAudio);
            } catch (error) {
              console.error("Retry playback failed:", error);
            }
          };

          document.addEventListener("touchstart", resumeAudio, { once: true });
          document.addEventListener("click", resumeAudio, { once: true });
        }
      };

      playAudio();
    }
  }

  cleanup() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Only set state if connectionState exists and hasn't been cleaned up
    if (this.connectionState?.container) {
      this.connectionState.setState(this.connectionState.states.DISCONNECTED);
    }

    this.startTime = null;
    console.log("AudioStreamManager cleaned up");
  }
}
