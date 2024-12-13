import { AudioStreamManager } from "./audio-stream.js";
import { ConnectionState } from "./connection-state.js";
import { isLocalhost } from "./utils.js";

// Add environment configuration
const PRODUCTION =
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1";

class AudioDecayClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.userId = null;
    this.connections = new Map();
    this.audioManagers = new Map();
    this.users = new Map();
    this.logContainer = document.getElementById("connection-log");
    this.activeConnection = null; // Track the active connection
    this.connect();

    // Listen for connection state changes
    this.onConnectionStateChange = this.onConnectionStateChange.bind(this);
  }

  initializeConnection(peerId) {
    // Find or create the user's list item container
    const userItem = document.querySelector(
      `#users li[data-user-id="${peerId}"]`,
    );
    if (!userItem) {
      console.error("User list item not found");
      return null;
    }

    // Create connection state and audio manager
    const connectionState = new ConnectionState(userItem);
    this.connections.set(peerId, connectionState);

    const audioManager = new AudioStreamManager(connectionState);
    this.audioManagers.set(peerId, audioManager);

    // Add state change listener
    connectionState.on("stateChange", ({ newState }) => {
      this.onConnectionStateChange(peerId, newState);
    });

    return { connectionState, audioManager };
  }

  async cleanupConnection(peerId) {
    if (!this.connections.has(peerId) && !this.audioManagers.has(peerId))
      return;

    const connection = this.connections.get(peerId);
    if (connection) {
      clearInterval(connection.statsInterval);
      connection.cleanup();
      this.connections.delete(peerId);
    }

    const audioManager = this.audioManagers.get(peerId);
    if (audioManager) {
      await audioManager.cleanup().catch(console.warn);
      this.audioManagers.delete(peerId);
    }

    if (this.activeConnection === peerId) {
      this.activeConnection = null;
      this.updateUserList([...this.users.values()]);
    }
  }

  addLogEntry(message, type = "info") {
    const entry = document.createElement("div");
    entry.className = `log-entry log-${type}`;
    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = `[${timestamp}] ${message}`;

    this.logContainer.appendChild(entry);
    this.logContainer.scrollTop = this.logContainer.scrollHeight;
  }

  updateUserList(users) {
    const usersList = document.getElementById("users");
    usersList.innerHTML = "";

    // Update users map first
    this.users = new Map(users.map((user) => [user.id, user]));

    users.forEach((user) => {
      const li = document.createElement("li");
      const isConnecting = this.activeConnection === user.id;
      const isConnected = this.isPeerConnected(user.id);

      li.className = `user-item${isConnected ? " connected" : ""}${isConnecting ? " connecting" : ""}`;
      li.setAttribute("data-user-id", user.id);

      li.innerHTML = `
        <div class="user-row">
          <div class="user-identity">
            <div class="status-indicator${isConnected ? " connected" : ""}${isConnecting ? " connecting" : ""}"></div>
            <span>User ${user.id}${user.id === this.userId ? " (You)" : ""}</span>
          </div>
          ${
            user.id !== this.userId
              ? `<button class="${isConnected ? "connected" : ""}" ${isConnecting && !isConnected ? "disabled" : ""}>
            ${isConnected ? "Disconnect" : isConnecting ? "Connecting..." : "Connect"}
          </button>`
              : ""
          }
        </div>
      `;

      // Add connection state container if connected or connecting
      if (isConnected || isConnecting) {
        const connection = this.connections.get(user.id);
        if (connection?.container) {
          li.appendChild(connection.container);
        }
      }

      // Add click handler for connect/disconnect button
      if (user.id !== this.userId) {
        const button = li.querySelector("button");
        button.onclick = () => {
          if (isConnected) {
            this.disconnectFromPeer(user.id);
          } else if (!isConnecting) {
            this.requestConnection(user.id);
          }
        };
      }

      usersList.appendChild(li);
    });
  }

  isPeerConnected(peerId) {
    return this.activeConnection === peerId;
  }

  async disconnectFromPeer(peerId) {
    try {
      const stateMsg = {
        type: "PeerStateChange",
        from_id: this.userId,
        to_id: peerId,
        state: "disconnected",
      };

      // Send disconnect message first
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(stateMsg));
      }

      // Reset active connection
      if (this.activeConnection === peerId) {
        this.activeConnection = null;
      }

      // Perform cleanup
      await this.cleanupConnection(peerId);
      this.addLogEntry(`Disconnected from User ${peerId}`, "disconnect");

      // Update UI immediately
      this.updateUserList([...this.users.values()]);
    } catch (error) {
      console.error("Error during disconnect:", error);
      // Attempt cleanup anyway
      await this.cleanupConnection(peerId);
      this.updateUserList([...this.users.values()]);
    }
  }

  connect() {
    if (this.ws) {
      return;
    }

    const isDevelopment = isLocalhost(window.location.hostname);
    const wsUrl = isDevelopment
      ? `wss://${window.location.host}/ws`
      : "wss://audio-decay-worker.jacksongoode.workers.dev/ws";

    console.log("[AudioDecayClient] Connecting to WebSocket:", wsUrl);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this.addLogEntry("Connected to server", "connect");
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      this.addLogEntry(`Connection error: ${error}`, "disconnect");
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      this.addLogEntry("Disconnected from server", "disconnect");

      // Auto-reconnect after a short delay
      setTimeout(() => {
        if (!this.ws) {
          this.connect();
        }
      }, 3000);
    };
  }

  handleMessage(message) {
    switch (message.type) {
      case "Welcome":
        this.userId = message.user_id;
        this.addLogEntry(`Connected as User ${this.userId}`, "connect");
        // Add ourselves to the users map immediately
        this.users.set(this.userId, {
          id: this.userId,
          name: `User ${this.userId}`,
        });
        break;
      case "UserList":
        this.updateUserList(message.users);
        break;
      case "ConnectionRequest":
        this.handleConnectionRequest(message);
        break;
      case "ConnectionResponse":
        this.handleConnectionResponse(message);
        break;
      case "RTCOffer":
        this.handleRTCOffer(message);
        break;
      case "RTCAnswer":
        this.handleRTCAnswer(message);
        break;
      case "RTCCandidate":
        this.handleRTCCandidate(message);
        break;
      case "PeerStateChange":
        this.addLogEntry(
          `User ${message.from_id} ${message.state === "connected" ? "connected to" : "disconnected from"} User ${message.to_id}`,
          message.state === "connected" ? "connect" : "disconnect",
        );

        if (message.from_id === this.userId || message.to_id === this.userId) {
          const peerId =
            message.from_id === this.userId ? message.to_id : message.from_id;
          const connection = this.connections.get(peerId);

          if (message.state === "connected") {
            if (connection) {
              connection.setState(connection.states.CONNECTED);
            }
          } else {
            this.cleanupConnection(peerId);
          }

          this.updateUserList([...this.users.values()]);
        }
        break;
    }
  }

  async handleConnectionRequest(message) {
    // Only accept if we're not already connected
    if (this.activeConnection) {
      this.ws.send(
        JSON.stringify({
          type: "ConnectionResponse",
          from_id: message.from_id,
          accepted: false,
        }),
      );
      return;
    }

    const accepted = confirm(
      `User ${message.from_id} wants to connect. Accept?`,
    );

    if (accepted) {
      const { connectionState, audioManager } = this.initializeConnection(
        message.from_id,
      );
      this.activeConnection = message.from_id;
      this.updateUserList([...this.users.values()]);

      try {
        const peerConnection = await audioManager.createPeerConnection(
          (event) => {
            console.log(
              "Received track:",
              event.track.kind,
              event.track.readyState,
            );
            if (event.track.kind === "audio") {
              this.addLogEntry(
                `Receiving audio from User ${message.from_id}`,
                "connect",
              );
              audioManager.handleRemoteTrack(event.track, event.streams[0]);
            }
          },
        );

        // Create and send offer
        const offer = await peerConnection.createOffer({
          offerToReceiveAudio: true,
        });
        await peerConnection.setLocalDescription(offer);

        this.ws.send(
          JSON.stringify({
            type: "RTCOffer",
            from_id: this.userId,
            to_id: message.from_id,
            offer: JSON.stringify(offer),
          }),
        );
      } catch (error) {
        this.addLogEntry(`Connection error: ${error.message}`, "disconnect");
        await this.cleanupConnection(message.from_id);
      }
    }

    this.ws.send(
      JSON.stringify({
        type: "ConnectionResponse",
        from_id: message.from_id,
        accepted,
      }),
    );
  }

  async handleConnectionResponse(message) {
    if (message.accepted) {
      this.addLogEntry(
        `User ${message.from_id} accepted connection`,
        "connect",
      );
    } else {
      this.addLogEntry(
        `User ${message.from_id} rejected connection`,
        "disconnect",
      );
      this.audioManager?.cleanup();
    }
  }

  async requestConnection(peerId) {
    try {
      const { connectionState, audioManager } = this.initializeConnection(peerId);
      
      // Initialize audio context and processing first
      await audioManager.initializeAudioContext();
      
      // Create peer connection
      const peerConnection = await audioManager.createPeerConnection((event) => {
        if (event.candidate) {
          this.ws.send(JSON.stringify({
            type: "RTCCandidate",
            from_id: this.userId,
            to_id: peerId,
            candidate: JSON.stringify(event.candidate)
          }));
        }
      });

      // Get user media and add tracks
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      stream.getAudioTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
      });

      this.activeConnection = peerId;
      this.updateUserList([...this.users.values()]);

      // Create and send offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      this.ws.send(JSON.stringify({
        type: "RTCOffer",
        from_id: this.userId,
        to_id: peerId,
        offer: JSON.stringify(offer)
      }));

    } catch (error) {
      console.error("Connection request failed:", error);
      this.activeConnection = null;
      await this.cleanupConnection(peerId);
      throw error;
    }
  }

  async handleRTCOffer(message) {
    const { connectionState, audioManager } = this.initializeConnection(
      message.from_id,
    );

    try {
      const peerConnection = await audioManager.createPeerConnection(
        (event) => {
          if (event.candidate) {
            this.ws.send(
              JSON.stringify({
                type: "RTCCandidate",
                from_id: this.userId,
                to_id: message.from_id,
                candidate: JSON.stringify(event.candidate),
              }),
            );
          }
        },
      );

      // Set remote description first
      const offer = JSON.parse(message.offer);
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer),
      );

      // Create and set local description
      const answer = await peerConnection.createAnswer({
        offerToReceiveAudio: true,
      });
      await peerConnection.setLocalDescription(answer);

      // Send answer immediately
      this.ws.send(
        JSON.stringify({
          type: "RTCAnswer",
          from_id: this.userId,
          to_id: message.from_id,
          answer: JSON.stringify(answer),
        }),
      );

      // Set active connection AFTER successful setup
      this.activeConnection = message.from_id;
      this.updateUserList([...this.users.values()]);
    } catch (error) {
      console.error("Failed to handle offer:", error);
      await this.cleanupConnection(message.from_id);
    }
  }

  async handleRTCAnswer(message) {
    const audioManager = this.audioManagers.get(message.from_id);
    const connectionState = this.connections.get(message.from_id);

    try {
      const answer = JSON.parse(message.answer);
      await audioManager.peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer),
      );

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, 30000);

        let iceComplete = false;
        let connectionComplete = false;

        const checkState = () => {
          if (
            audioManager.peerConnection.iceConnectionState === "failed" ||
            audioManager.peerConnection.connectionState === "failed"
          ) {
            console.log("Connection failed");
            clearTimeout(timeout);
            reject(new Error("Connection failed"));
          }

          if (audioManager.peerConnection.iceGatheringState === "complete") {
            iceComplete = true;
          }

          if (
            ["connected", "completed"].includes(
              audioManager.peerConnection.iceConnectionState,
            )
          ) {
            connectionComplete = true;
          }

          if (iceComplete && connectionComplete) {
            clearTimeout(timeout);
            resolve();
          }
        };

        audioManager.peerConnection.addEventListener(
          "icegatheringstatechange",
          checkState,
        );
        audioManager.peerConnection.addEventListener(
          "iceconnectionstatechange",
          checkState,
        );
        audioManager.peerConnection.addEventListener(
          "connectionstatechange",
          checkState,
        );

        checkState();
      });

      await this.monitorConnection(message.from_id);
      connectionState.setState(connectionState.states.CONNECTED);
    } catch (error) {
      console.error("Failed to handle answer:", error);
      await this.cleanupConnection(message.from_id);
    }
  }

  async handleRTCCandidate(message) {
    const audioManager = this.audioManagers.get(message.from_id);
    if (audioManager?.peerConnection?.connectionState !== "failed") {
      try {
        const candidate = JSON.parse(message.candidate);
        await audioManager?.peerConnection
          ?.addIceCandidate(new RTCIceCandidate(candidate))
          .catch(() => {}); // Ignore ICE candidate errors
      } catch (error) {
        console.warn("ICE candidate handling failed:", error);
      }
    }
  }

  // Move this common code to a new method
  setupAudioPlayback(audio, audioManager) {
    audio.autoplay = true;
    audio.playsInline = true;

    const playAudio = async () => {
      try {
        await audio.play();
        audioManager.startAudioDecay(); // This triggers the UI update
      } catch (err) {
        console.error("Audio playback failed:", err);
        this.addLogEntry(`Error playing audio: ${err.message}`, "disconnect");
        document.addEventListener(
          "click",
          async () => {
            try {
              await audio.play();
              audioManager.startAudioDecay(); // Also here for retry
            } catch (error) {
              console.error("Retry playback failed:", error);
            }
          },
          { once: true },
        );
      }
    };

    playAudio();
  }

  onConnectionStateChange(peerId, state) {
    if (state === "connected") {
      this.updateUserList([...this.users.values()]);
    } else if (state === "failed" || state === "disconnected") {
      this.handleConnectionFailure(peerId);
    }
  }

  async handleConnectionFailure(peerId) {
    console.log("Handling connection failure for peer:", peerId);

    // Single cleanup attempt with no retries
    await this.cleanupConnection(peerId);

    // Only attempt reconnection if this is still the active connection
    if (this.activeConnection === peerId) {
      this.addLogEntry(`Connection failed with User ${peerId}`, "disconnect");
      this.activeConnection = null;
      this.updateUserList([...this.users.values()]);
    }
  }

  async monitorConnection(peerId) {
    const audioManager = this.audioManagers.get(peerId);
    const connectionState = this.connections.get(peerId);
    if (!audioManager?.peerConnection || !connectionState) return;

    const startTime = Date.now();
    let lastBytes = 0;
    let lastTimestamp = startTime;

    const updateStats = async () => {
      if (this.activeConnection !== peerId) return;

      try {
        const stats = await audioManager.peerConnection.getStats();
        let bitrate = 0;
        let audioLevel = 0;

        stats.forEach((report) => {
          if (
            (report.type === "inbound-rtp" || report.type === "outbound-rtp") &&
            report.kind === "audio"
          ) {
            const now = report.timestamp;
            const bytes =
              report.type === "inbound-rtp"
                ? report.bytesReceived
                : report.bytesSent;
            const timeDiff = (now - lastTimestamp) / 1000;

            if (lastBytes > 0 && timeDiff > 0) {
              bitrate = Math.round(
                ((bytes - lastBytes) * 8) / (timeDiff * 1000),
              );
            }

            lastBytes = bytes;
            lastTimestamp = now;

            // Also monitor audio levels if available
            if (report.audioLevel) {
              audioLevel = Math.round(report.audioLevel * 100);
            }
          }
        });

        connectionState.updateStats({
          bitrate,
          audioLevel,
          elapsedTime: (Date.now() - startTime) / 1000,
        });
      } catch (error) {
        console.warn("Failed to get connection stats:", error);
      }
    };

    // Update stats every second
    const statsInterval = setInterval(updateStats, 1000);
    this.connections.get(peerId).statsInterval = statsInterval;
  }
}

// Initialize the application when the page loads
document.addEventListener("DOMContentLoaded", () => {
  window.client = new AudioDecayClient();
});
