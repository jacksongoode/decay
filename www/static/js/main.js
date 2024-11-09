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
    // Prevent recursive cleanup
    if (!this.connections.has(peerId) && !this.audioManagers.has(peerId)) {
      return;
    }

    console.log(`Starting cleanup for peer: ${peerId}`);

    // Clean up audio manager first
    const audioManager = this.audioManagers.get(peerId);
    if (audioManager) {
      try {
        if (typeof audioManager.cleanup === "function") {
          await audioManager.cleanup();
        }
      } catch (err) {
        console.warn("Audio manager cleanup error:", err);
      } finally {
        this.audioManagers.delete(peerId);
      }
    }

    // Clean up connection state last
    const connection = this.connections.get(peerId);
    if (connection) {
      try {
        connection.cleanup();
      } finally {
        this.connections.delete(peerId);
      }
    }

    // Reset active connection only if it matches
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

  async requestConnection(peerId) {
    if (this.activeConnection === peerId) return;

    try {
      // The initializeConnection returns an object with both connectionState and audioManager
      const result = this.initializeConnection(peerId);
      if (!result) return; // Early return if initialization fails

      const { connectionState, audioManager } = result;

      // Track connection attempt
      this.activeConnection = peerId;
      connectionState.setState(connectionState.states.CONNECTING);

      // Create peer connection first
      await audioManager.createPeerConnection((event) => {
        if (event.candidate) {
          this.ws.send(
            JSON.stringify({
              type: "RTCCandidate",
              from_id: this.userId,
              to_id: peerId,
              candidate: JSON.stringify(event.candidate),
            }),
          );
        }
      });

      // Now create and set offer
      const offer = await audioManager.peerConnection.createOffer();
      await audioManager.peerConnection.setLocalDescription(offer);

      this.ws.send(
        JSON.stringify({
          type: "RTCOffer",
          from_id: this.userId,
          to_id: peerId,
          offer: JSON.stringify(offer),
        }),
      );

      this.updateUserList([...this.users.values()]);
    } catch (error) {
      console.error("Connection request failed:", error);
      this.activeConnection = null;
      await this.cleanupConnection(peerId);
      throw error; // Propagate error for proper handling
    }
  }

  async handleRTCOffer(message) {
    const { connectionState, audioManager } = this.initializeConnection(
      message.from_id,
    );

    // Set active connection and update UI immediately
    this.activeConnection = message.from_id;
    connectionState.setState(connectionState.states.CONNECTING);
    this.updateUserList([...this.users.values()]);

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
        await this.setupAudioPlayback(audio, audioManager);
      };

      // First set the remote description
      const offer = JSON.parse(message.offer);
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer),
      );

      // Then create and set local description
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      // Send answer
      this.ws.send(
        JSON.stringify({
          type: "RTCAnswer",
          from_id: this.userId,
          to_id: message.from_id,
          answer: JSON.stringify(answer),
        }),
      );

      // Wait for ICE gathering to complete
      if (peerConnection.iceGatheringState !== "complete") {
        await new Promise((resolve) => {
          peerConnection.addEventListener("icegatheringstatechange", () => {
            if (peerConnection.iceGatheringState === "complete") {
              resolve();
            }
          });
        });
      }

      // Update state after successful connection
      connectionState.setState(connectionState.states.CONNECTED);
    } catch (error) {
      console.error("Failed to handle offer:", error);
      this.activeConnection = null;
      connectionState.setState(connectionState.states.FAILED);
      this.cleanupConnection(message.from_id);
    }
  }

  async handleRTCAnswer(message) {
    const audioManager = this.audioManagers.get(message.from_id);
    const connectionState = this.connections.get(message.from_id);

    // More comprehensive state checking
    if (!audioManager?.peerConnection || !connectionState) {
      console.warn("Invalid connection state for answer");
      await this.cleanupConnection(message.from_id);
      return;
    }

    try {
      const answer = JSON.parse(message.answer);
      const signalingState = audioManager.peerConnection.signalingState;

      // Enhanced state validation
      if (signalingState === "have-local-offer") {
        await audioManager.peerConnection.setRemoteDescription(
          new RTCSessionDescription(answer),
        );

        // Wait for connection to stabilize
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Connection timeout")),
            5000,
          );

          const checkState = () => {
            if (audioManager.peerConnection.connectionState === "connected") {
              clearTimeout(timeout);
              resolve();
            } else if (
              audioManager.peerConnection.connectionState === "failed"
            ) {
              clearTimeout(timeout);
              reject(new Error("Connection failed"));
            }
          };

          audioManager.peerConnection.addEventListener(
            "connectionstatechange",
            checkState,
          );
          checkState(); // Check immediately in case we're already connected
        });

        connectionState.setState(connectionState.states.CONNECTED);
      } else {
        throw new Error(`Invalid signaling state: ${signalingState}`);
      }
    } catch (error) {
      console.error("Failed to handle answer:", error);

      // Enhanced error handling with retries
      if (this.activeConnection === message.from_id) {
        const maxRetries = 3;
        let retryCount = 0;

        const retry = async () => {
          if (retryCount >= maxRetries) {
            await this.cleanupConnection(message.from_id);
            return;
          }

          try {
            retryCount++;
            await this.cleanupConnection(message.from_id);
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * retryCount),
            );
            await this.requestConnection(message.from_id);
          } catch (retryError) {
            console.error(`Retry ${retryCount} failed:`, retryError);
            await retry();
          }
        };

        await retry();
      } else {
        await this.cleanupConnection(message.from_id);
      }
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

    const maxRetries = 3;
    const baseDelay = 1000; // 1 second base delay

    const cleanup = async () => {
      if (this.audioManagers.has(peerId)) {
        const audioManager = this.audioManagers.get(peerId);
        await audioManager?.cleanup().catch(console.warn);
        this.audioManagers.delete(peerId);
      }

      if (this.connections.has(peerId)) {
        await this.cleanupConnection(peerId);
      }
    };

    // Use exponential backoff with Promise
    const attemptReconnection = async (attempt = 0) => {
      if (attempt >= maxRetries) {
        this.addLogEntry(
          `Connection failed after ${maxRetries} attempts`,
          "disconnect",
        );
        await cleanup();
        return;
      }

      const delay = baseDelay * Math.pow(2, attempt);

      try {
        await cleanup();

        // Only attempt reconnection if this is still the active connection
        if (this.activeConnection === peerId) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          await this.requestConnection(peerId);
        }
      } catch (error) {
        console.error(`Reconnection attempt ${attempt + 1} failed:`, error);
        // Recursively try next attempt
        await attemptReconnection(attempt + 1);
      }
    };

    // Start the reconnection process
    await attemptReconnection();
  }
}

// Initialize the application when the page loads
document.addEventListener("DOMContentLoaded", () => {
  window.client = new AudioDecayClient();
});
