class AudioDecayClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.users = new Map();
    this.userId = null;
    this.currentPeer = null;
    this.setupEventListeners();
    this.logContainer = document.getElementById("connection-log");
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

    this.ws = new WebSocket(`ws://${window.location.host}/ws`);

    this.ws.onopen = () => {
      this.connected = true;
      this.updateUI();
      this.addLogEntry("Connected to server", "connect");
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

  updateUI() {
    document.getElementById("connect").disabled = this.connected;
    document.getElementById("disconnect").disabled = !this.connected;
    document.getElementById("status").textContent = this.connected
      ? "Connected"
      : "Disconnected";
  }

  handleMessage(message) {
    switch (message.type) {
      case "Welcome":
        this.userId = message.user_id;
        console.log("Received user ID:", this.userId);
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
    }
  }

  async handleConnectionRequest(message) {
    const accepted = confirm(
      `User ${message.from_id} wants to connect. Accept?`,
    );

    if (accepted) {
      const audioManager = new AudioStreamManager();
      const peerConnection = await audioManager.connectToPeer(message.from_id);

      peerConnection.onicecandidate = (event) => {
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

      // Handle incoming audio stream
      peerConnection.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
      };
    }

    const response = {
      type: "ConnectionResponse",
      from_id: message.from_id,
      accepted,
    };
    this.ws.send(JSON.stringify(response));
  }

  async requestConnection(userId) {
    if (this.ws) {
      const request = {
        type: "ConnectionRequest",
        from_id: this.userId,
        to_id: userId,
      };
      this.ws.send(JSON.stringify(request));

      if (this.audioManager) {
        this.audioManager.disconnect();
      }
      this.audioManager = new AudioStreamManager();
      const peerConnection = await this.audioManager.connectToPeer(userId);

      const offer = await this.audioManager.createOffer();
      const offerMsg = {
        type: "RTCOffer",
        from_id: this.userId,
        to_id: userId,
        offer: JSON.stringify(offer),
      };
      this.ws.send(JSON.stringify(offerMsg));
    }
  }
}

// Initialize the client when the page loads
window.addEventListener("load", () => {
  window.client = new AudioDecayClient();
});
