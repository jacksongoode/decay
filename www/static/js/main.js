import { AudioStreamManager } from "./audio-stream.js";
import { ConnectionState } from "./connection-state.js";

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
    const container = document.getElementById("connections-container");
    const connectionState = new ConnectionState(peerId, container);
    this.connections.set(peerId, connectionState);

    const audioManager = new AudioStreamManager(connectionState);
    this.audioManagers.set(peerId, audioManager);

    // Add state change listener
    connectionState.on("stateChange", ({ newState }) => {
      this.onConnectionStateChange(peerId, newState);
    });

    return { connectionState, audioManager };
  }

  cleanupConnection(peerId) {
    // Clean up audio manager before connection state
    const audioManager = this.audioManagers.get(peerId);
    if (audioManager) {
      audioManager.cleanup();
      this.audioManagers.delete(peerId);
    }

    // Clean up connection state last
    const connection = this.connections.get(peerId);
    if (connection) {
      connection.cleanup();
      this.connections.delete(peerId);
    }

    this.activeConnection = null;
    this.updateUserList([...this.users.values()]);
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
    const userList = document.getElementById("users");
    userList.innerHTML = "";

    // Make sure we're included in the users list
    if (!users.some((u) => u.id === this.userId)) {
      users.push({
        id: this.userId,
        name: `User ${this.userId}`,
      });
    }

    // Update users map
    this.users = new Map(users.map((user) => [user.id, user]));

    users.forEach((user) => {
      const li = document.createElement("li");
      li.className = "user-item";
      const isConnected = this.isPeerConnected(user.id);
      if (isConnected) {
        li.classList.add("connected");
      }

      const userRow = document.createElement("div");
      userRow.className = "user-row";

      const userIdentity = document.createElement("div");
      userIdentity.className = "user-identity";

      const statusDot = document.createElement("span");
      statusDot.className = "status-indicator";
      if (isConnected) {
        statusDot.classList.add("connected");
      }

      const userName = document.createElement("span");
      const isMe = user.id === this.userId;
      userName.textContent = `User ${user.id} ${isMe ? "(You)" : ""}`;

      userIdentity.appendChild(statusDot);
      userIdentity.appendChild(userName);
      userRow.appendChild(userIdentity);

      // Only show connect/disconnect button for other users
      if (!isMe) {
        const connectBtn = document.createElement("button");
        connectBtn.disabled = this.activeConnection && !isConnected;

        if (isConnected) {
          connectBtn.textContent = "Disconnect";
          connectBtn.classList.add("connected");
        } else {
          connectBtn.textContent = "Connect";
        }

        connectBtn.onclick = () => {
          if (isConnected) {
            this.disconnectFromPeer(user.id);
          } else {
            this.requestConnection(user.id);
          }
        };
        userRow.appendChild(connectBtn);
      }

      li.appendChild(userRow);

      // Add connection state if it exists
      const connection = this.connections.get(user.id);
      if (connection) {
        // Create container if it doesn't exist
        if (!connection.container) {
          connection.container = connection.createContainer();
        }
        // Add the connection's container directly
        const statsContainer = document.createElement("div");
        statsContainer.className = "stream-stats";
        statsContainer.appendChild(connection.container);
        li.appendChild(statsContainer);
      }

      userList.appendChild(li);
    });
  }

  isPeerConnected(peerId) {
    return this.activeConnection === peerId;
  }

  disconnectFromPeer(peerId) {
    const stateMsg = {
      type: "PeerStateChange",
      from_id: this.userId,
      to_id: peerId,
      connected: false,
    };
    this.ws.send(JSON.stringify(stateMsg));

    this.cleanupConnection(peerId);
    this.activeConnection = null;
    this.updateUserList([...this.users.values()]);
  }

  connect() {
    if (this.ws) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const port = window.location.protocol === "https:" ? "3443" : "3030";
    this.ws = new WebSocket(
      `${protocol}//${window.location.hostname}:${port}/ws`,
    );

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
          `User ${message.from_id} ${message.connected ? "connected to" : "disconnected from"} User ${message.to_id}`,
          message.connected ? "connect" : "disconnect",
        );

        if (message.from_id === this.userId || message.to_id === this.userId) {
          const peerId =
            message.from_id === this.userId ? message.to_id : message.from_id;

          if (!message.connected) {
            this.cleanupConnection(peerId);
          }

          this.updateUserList([...this.users.values()]);
        }
        break;
    }
  }

  async handleConnectionRequest(message) {
    if (this.activeConnection) {
      const response = {
        type: "ConnectionResponse",
        from_id: message.from_id,
        accepted: false,
      };
      this.ws.send(JSON.stringify(response));
      return;
    }

    const accepted = confirm(
      `User ${message.from_id} wants to connect. Accept?`,
    );

    if (accepted) {
      const { connectionState, audioManager } = this.initializeConnection(
        message.from_id,
      );
      this.activeConnection = message.from_id; // Set active connection for receiving peer
      this.updateUserList([...this.users.values()]); // Update UI immediately

      try {
        const onIceCandidate = (event) => {
          if (event.candidate) {
            const candidateMsg = {
              type: "RTCCandidate",
              from_id: this.userId,
              to_id: message.from_id,
              candidate: JSON.stringify(event.candidate),
            };
            this.ws.send(JSON.stringify(candidateMsg));
          }
        };

        const peerConnection =
          await audioManager.createPeerConnection(onIceCandidate);

        peerConnection.ontrack = async (event) => {
          this.addLogEntry(
            `Receiving audio from User ${message.from_id}`,
            "connect",
          );
          const audio = new Audio();
          audio.srcObject = event.streams[0];
          this.setupAudioPlayback(audio, audioManager);
        };
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        const offerMsg = {
          type: "RTCOffer",
          from_id: this.userId,
          to_id: message.from_id,
          offer: JSON.stringify(offer),
        };
        this.ws.send(JSON.stringify(offerMsg));
        this.addLogEntry(
          `Sent connection request to User ${message.from_id}`,
          "connect",
        );
      } catch (error) {
        this.activeConnection = null; // Clear on error
        this.addLogEntry(`Connection error: ${error.message}`, "disconnect");
        this.cleanupConnection(message.from_id);
      }
    }

    const response = {
      type: "ConnectionResponse",
      from_id: message.from_id,
      accepted,
    };
    this.ws.send(JSON.stringify(response));
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

  async requestConnection(userId) {
    if (this.activeConnection) {
      this.addLogEntry("You already have an active connection", "info");
      return;
    }

    try {
      this.addLogEntry(`Requesting connection to User ${userId}...`, "info");
      const { connectionState, audioManager } =
        this.initializeConnection(userId);
      this.activeConnection = userId; // Set active connection immediately
      this.updateUserList([...this.users.values()]); // Update UI right away

      // Check for secure context
      if (!window.isSecureContext) {
        throw new Error(
          "Media devices require a secure context (HTTPS or localhost)",
        );
      }

      const peerConnection = await audioManager.createPeerConnection(
        (event) => {
          if (event.candidate) {
            const candidateMsg = {
              type: "RTCCandidate",
              from_id: this.userId,
              to_id: userId,
              candidate: JSON.stringify(event.candidate),
            };
            this.ws.send(JSON.stringify(candidateMsg));
          }
        },
      );

      // Add ontrack handler for the initiating side
      peerConnection.ontrack = async (event) => {
        this.addLogEntry(`Receiving audio from User ${userId}`, "connect");
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        this.setupAudioPlayback(audio, audioManager);
      };
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const offerMsg = {
        type: "RTCOffer",
        from_id: this.userId,
        to_id: userId,
        offer: JSON.stringify(offer),
      };
      this.ws.send(JSON.stringify(offerMsg));
      this.addLogEntry(`Sent connection request to User ${userId}`, "connect");
    } catch (error) {
      this.activeConnection = null; // Clear active connection on error
      this.addLogEntry(`Connection error: ${error.message}`, "disconnect");
      this.cleanupConnection(userId);
    }
  }

  async handleRTCOffer(message) {
    const { connectionState, audioManager } = this.initializeConnection(
      message.from_id,
    );
    this.activeConnection = message.from_id; // Set active connection for receiving peer
    this.updateUserList([...this.users.values()]); // Update UI immediately

    try {
      const peerConnection = await audioManager.createPeerConnection(
        (event) => {
          if (event.candidate) {
            const candidateMsg = {
              type: "RTCCandidate",
              from_id: this.userId,
              to_id: message.from_id,
              candidate: JSON.stringify(event.candidate),
            };
            this.ws.send(JSON.stringify(candidateMsg));
          }
        },
      );

      // Add ontrack handler for receiving end
      peerConnection.ontrack = async (event) => {
        this.addLogEntry(
          `Receiving audio from User ${message.from_id}`,
          "connect",
        );
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        this.setupAudioPlayback(audio, audioManager);
      };

      // First set the remote description
      const offer = JSON.parse(message.offer);
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer),
      );

      // Then create and set local description
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      // Send answer immediately without waiting for ICE gathering
      this.ws.send(
        JSON.stringify({
          type: "RTCAnswer",
          from_id: this.userId,
          to_id: message.from_id,
          answer: JSON.stringify(answer),
        }),
      );
    } catch (error) {
      console.error("Failed to handle offer:", error);
      this.activeConnection = null;
      this.cleanupConnection(message.from_id);
    }
  }

  async handleRTCAnswer(message) {
    const audioManager = this.audioManagers.get(message.from_id);
    if (audioManager?.peerConnection) {
      try {
        const answer = JSON.parse(message.answer);
        await audioManager.peerConnection.setRemoteDescription(
          new RTCSessionDescription(answer),
        );
      } catch (error) {
        console.error("Failed to handle answer:", error);
        this.cleanupConnection(message.from_id);
      }
    }
  }

  async handleRTCCandidate(message) {
    const audioManager = this.audioManagers.get(message.from_id);
    if (audioManager?.peerConnection) {
      try {
        const candidate = JSON.parse(message.candidate);
        await audioManager.peerConnection.addIceCandidate(
          new RTCIceCandidate(candidate),
        );
      } catch (error) {
        console.error("Failed to add ICE candidate:", error);
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
    }
  }
}

// Initialize the application when the page loads
document.addEventListener("DOMContentLoaded", () => {
  window.client = new AudioDecayClient();
});
