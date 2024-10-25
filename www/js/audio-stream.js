export class AudioStreamManager {
  constructor() {
    this.stream = null;
    this.audioContext = null;
    this.peerConnection = null;
  }

  async initializeStream() {
    try {
      console.log("Checking media devices support...");

      // Check if mediaDevices exists, if not, try to get it
      if (!navigator.mediaDevices) {
        navigator.mediaDevices = {};
      }

      // Check if getUserMedia is supported
      if (!navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia = function (constraints) {
          const getUserMedia =
            navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia ||
            navigator.msGetUserMedia;

          if (!getUserMedia) {
            return Promise.reject(
              new Error("getUserMedia is not supported in this browser"),
            );
          }

          return new Promise((resolve, reject) => {
            getUserMedia.call(navigator, constraints, resolve, reject);
          });
        };
      }

      // Request permissions explicitly
      console.log("Requesting microphone access...");
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      console.log("Microphone access granted");

      // Create audio context with fallbacks
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContext();

      return true;
    } catch (error) {
      console.error("Error accessing microphone:", error);
      let errorMessage = "Microphone access failed: ";

      switch (error.name) {
        case "NotAllowedError":
          errorMessage += "Permission denied. Please allow microphone access.";
          break;
        case "NotFoundError":
          errorMessage += "No microphone found.";
          break;
        case "NotReadableError":
          errorMessage += "Microphone is already in use.";
          break;
        case "SecurityError":
          errorMessage +=
            "Media support is not available in insecure context. Please use HTTPS.";
          break;
        default:
          errorMessage += error.message || "Unknown error";
      }

      throw new Error(errorMessage);
    }
  }

  async createPeerConnection(onIceCandidate) {
    try {
      if (!this.stream) {
        await this.initializeStream();
      }

      console.log("Creating peer connection...");
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      this.peerConnection.onicecandidate = onIceCandidate;
      this.peerConnection.oniceconnectionstatechange = () => {
        console.log(
          "ICE Connection State:",
          this.peerConnection.iceConnectionState,
        );
      };

      this.stream.getTracks().forEach((track) => {
        console.log("Adding track to peer connection:", track.kind);
        this.peerConnection.addTrack(track, this.stream);
      });

      return this.peerConnection;
    } catch (error) {
      console.error("Error creating peer connection:", error);
      throw error;
    }
  }

  cleanup() {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    console.log("AudioStreamManager cleaned up");
  }
}

export default AudioStreamManager;
