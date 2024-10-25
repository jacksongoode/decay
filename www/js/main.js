import { AudioStreamManager } from "./audio-stream.js";

class AudioDecayClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.userId = null;
    this.audioManager = null;
    this.users = new Map();
    this.logContainer = document.getElementById("connection-log");
    this.setupEventListeners();
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

    // Find new and removed users
    const currentUserIds = new Set(users.map((u) => u.id));
    const previousUserIds = new Set(Array.from(this.users.keys()));

    // Check for new users
    for (const user of users) {
      if (!previousUserIds.has(user.id) && user.id !== this.userId) {
        this.addLogEntry(`User ${user.id} connected`, "connect");
      }
    }

    // Check for disconnected users
    for (const prevId of previousUserIds) {
      if (!currentUserIds.has(prevId) && prevId !== this.userId) {
        this.addLogEntry(`User ${prevId} disconnected`, "disconnect");
      }
    }

    // Update users map
    this.users = new Map(users.map((user) => [user.id, user]));

    // Update UI
    users.forEach((user) => {
      const li = document.createElement("li");
      li.className = "user-item";

      const userInfo = document.createElement("div");
      userInfo.className = "user-info";

      const statusDot = document.createElement("span");
      statusDot.className = "status-indicator";

      const userName = document.createElement("span");
      const isMe = user.id === this.userId;
      userName.textContent = `User ${user.id} ${isMe ? "(You)" : ""}`;

      userInfo.appendChild(statusDot);
      userInfo.appendChild(userName);
      li.appendChild(userInfo);

      if (!isMe) {
        const connectBtn = document.createElement("button");
        connectBtn.textContent = "Connect";
        connectBtn.onclick = () => this.requestConnection(user.id);
        li.appendChild(connectBtn);
      }

      userList.appendChild(li);
    });

    const totalUsers = users.length;
    document.getElementById("status").textContent =
      `${totalUsers} user${totalUsers !== 1 ? "s" : ""} connected`;
  }

  setupEventListeners() {
    document
      .getElementById("connect")
      .addEventListener("click", () => this.connect());
    document
      .getElementById("disconnect")
      .addEventListener("click", () => this.disconnect());
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
      this.updateUI();
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
      this.updateUI();
      this.addLogEntry("Disconnected from server", "disconnect");
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }

  updateUI({ loading = false } = {}) {
    document.getElementById("connect").disabled = this.connected || loading;
    document.getElementById("disconnect").disabled = !this.connected || loading;
    document.getElementById("status").textContent = loading
      ? "Connecting..."
      : this.connected
        ? "Connected"
        : "Disconnected";
  }

  handleMessage(message) {
    switch (message.type) {
      case "Welcome":
        this.userId = message.user_id;
        this.addLogEntry(`Assigned User ID: ${this.userId}`, "connect");
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
    }
  }

  async handleConnectionRequest(message) {
    const accepted = confirm(
      `User ${message.from_id} wants to connect. Accept?`,
    );

    if (accepted) {
      this.audioManager = new AudioStreamManager();
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
        await this.audioManager.createPeerConnection(onIceCandidate);

      peerConnection.ontrack = (event) => {
        this.addLogEntry(
          `Receiving audio from User ${message.from_id}`,
          "connect",
        );
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
      };

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      const answerMsg = {
        type: "RTCAnswer",
        from_id: this.userId,
        to_id: message.from_id,
        answer: JSON.stringify(answer),
      };
      this.ws.send(JSON.stringify(answerMsg));
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
    try {
      this.addLogEntry(`Requesting connection to User ${userId}...`, "info");

      // Check for secure context
      if (!window.isSecureContext) {
        throw new Error(
          "Media devices require a secure context (HTTPS or localhost)",
        );
      }

      this.audioManager = new AudioStreamManager();

      // Add loading state to UI
      this.updateUI({ loading: true });

      const onIceCandidate = (event) => {
        if (event.candidate) {
          const candidateMsg = {
            type: "RTCCandidate",
            from_id: this.userId,
            to_id: userId,
            candidate: JSON.stringify(event.candidate),
          };
          this.ws.send(JSON.stringify(candidateMsg));
        }
      };

      const peerConnection =
        await this.audioManager.createPeerConnection(onIceCandidate);

      peerConnection.ontrack = (event) => {
        this.addLogEntry(`Receiving audio from User ${userId}`, "connect");
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play().catch((err) => {
          this.addLogEntry(`Error playing audio: ${err.message}`, "disconnect");
        });
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
      console.error("Connection error:", error);
      this.addLogEntry(`Connection error: ${error.message}`, "disconnect");
      if (this.audioManager) {
        this.audioManager.cleanup();
      }
    } finally {
      // Reset loading state
      this.updateUI({ loading: false });
    }
  }

  async handleRTCOffer(message) {
    if (!this.audioManager) {
      this.audioManager = new AudioStreamManager();
    }

    const peerConnection = await this.audioManager.createPeerConnection(
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

    peerConnection.ontrack = (event) => {
      this.addLogEntry(
        `Receiving audio from User ${message.from_id}`,
        "connect",
      );
      const audio = new Audio();
      audio.srcObject = event.streams[0];
      audio.play();
    };

    const offer = JSON.parse(message.offer);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    const answerMsg = {
      type: "RTCAnswer",
      from_id: this.userId,
      to_id: message.from_id,
      answer: JSON.stringify(answer),
    };
    this.ws.send(JSON.stringify(answerMsg));
  }

  async handleRTCAnswer(message) {
    if (this.audioManager?.peerConnection) {
      const answer = JSON.parse(message.answer);
      await this.audioManager.peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer),
      );
      this.addLogEntry(
        `Established connection with User ${message.from_id}`,
        "connect",
      );
    }
  }

  async handleRTCCandidate(message) {
    if (this.audioManager?.peerConnection) {
      const candidate = JSON.parse(message.candidate);
      await this.audioManager.peerConnection.addIceCandidate(
        new RTCIceCandidate(candidate),
      );
    }
  }
}

// Initialize the client
const client = new AudioDecayClient();
