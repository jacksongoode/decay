import { isLocalhost, AUDIO_CONSTANTS } from "./utils.js";

export class AudioStreamManager {
  constructor(connectionState) {
    this.audioContext = null;
    this.peerConnection = null;
    this.connectionState = connectionState;
  }

  async initializeAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: AUDIO_CONSTANTS.LATENCY_HINT
      });
      await this.audioContext.resume();
    }
    return this.audioContext;
  }

  async createPeerConnection(onIceCandidate) {
    try {
      await this.initializeAudioContext();

      const config = {
        iceServers: [
          ...(isLocalhost ? [
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun2.l.google.com:19302" }
          ] : [
            { urls: process.env.STUN_SERVER || "stun:stun1.l.google.com:19302" }
          ])
        ]
      };

      this.peerConnection = new RTCPeerConnection(config);

      if (onIceCandidate) {
        this.peerConnection.onicecandidate = onIceCandidate;
      }

      // Handle incoming tracks
      this.peerConnection.ontrack = async (event) => {
        if (event.track.kind === 'audio') {
          const stream = new MediaStream([event.track]);
          const source = this.audioContext.createMediaStreamSource(stream);
          source.connect(this.audioContext.destination);
        }
      };

      return this.peerConnection;
    } catch (error) {
      console.error("Failed to create peer connection:", error);
      throw error;
    }
  }

  // Audio track acquisition with fallback
  async getAudioTrackWithFallback() {
    const constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: AUDIO_CONSTANTS.CHANNEL_COUNT,
      },
    };

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        return (
          await navigator.mediaDevices.getUserMedia(constraints)
        ).getAudioTracks()[0];
      }

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
          reject,
        );
      });
    } catch (error) {
      console.error("Failed to get audio track:", error);
      throw error;
    }
  }

  async cleanup() {
    try {
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }

      if (this.audioContext) {
        await this.audioContext.close();
      }

      this.audioContext = null;
    } catch (error) {
      console.warn("[AudioStreamManager] Cleanup error:", error);
    }
  }
}
