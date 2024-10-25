export class ConnectionState {
  constructor(peerId, parentContainer) {
    this.peerId = peerId;
    this.startTime = null;
    this.connected = false;
    this.eventListeners = new Map(); // Add event listener support
    this.states = {
      INITIALIZING: "initializing",
      CONNECTING: "connecting",
      CONNECTED: "connected",
      DISCONNECTED: "disconnected",
      FAILED: "failed",
    };
    this.container = this.createContainer(parentContainer);

    // Initialize with CONNECTING state
    setTimeout(() => {
      this.setState(this.states.CONNECTING);
    }, 0);

    // Add connection timeout
    this.connectionTimeout = setTimeout(() => {
      if (this.currentState === this.states.CONNECTING) {
        console.error("Connection timeout");
        this.setState(this.states.FAILED);
      }
    }, 15000); // 15 second timeout

    // Add visibility change handling
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);

    // Enhanced unload handling
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
    window.addEventListener("beforeunload", this.handleBeforeUnload);
    window.addEventListener("unload", this.handleBeforeUnload);
    window.addEventListener("pagehide", this.handleBeforeUnload);

    this.startHeartbeat();
  }

  createContainer() {
    const statsDiv = document.createElement("div");
    statsDiv.className = "stream-stats";
    statsDiv.innerHTML = `
      <div class="connection-status">Status: ${this.getStatusText()}</div>
      <div class="bitrate">Bitrate: -- kbps</div>
      <div class="duration">Duration: 0:00</div>
    `;
    return statsDiv;
  }

  getStatusText() {
    switch (this.currentState) {
      case this.states.INITIALIZING:
        return "Initializing...";
      case this.states.CONNECTING:
        return "Connecting...";
      case this.states.CONNECTED:
        return "Connected";
      case this.states.DISCONNECTED:
        return "Disconnected";
      case this.states.FAILED:
        return "Failed";
      default:
        return "Unknown";
    }
  }

  updateState({ currentBitrate, elapsedTime, actualBitrate }) {
    if (!this.connected || !this.container) return;

    const bitrateEl = this.container.querySelector(".bitrate");
    const durationEl = this.container.querySelector(".duration");

    if (bitrateEl) {
      const bitrateText = actualBitrate
        ? `Bitrate: ${currentBitrate.toFixed(1)} kbps (actual: ${actualBitrate.toFixed(1)} kbps)`
        : `Bitrate: ${currentBitrate.toFixed(1)} kbps`;
      bitrateEl.textContent = bitrateText;
    }

    if (durationEl) {
      const minutes = Math.floor(elapsedTime / 60);
      const seconds = Math.floor(elapsedTime % 60);
      const timeString = `${minutes}:${seconds.toString().padStart(2, "0")}`;
      durationEl.textContent = `Duration: ${timeString}`;
    }
  }

  setState(newState) {
    const prevState = this.currentState;
    this.currentState = newState;
    this.connected = newState === this.states.CONNECTED;

    // Ensure container exists
    if (!this.container) {
      this.container = this.createContainer();
    }

    // Update the status text
    const statusEl = this.container.querySelector(".connection-status");
    if (statusEl) {
      statusEl.textContent = `Status: ${this.getStatusText()}`;
    }

    // Don't hide the container, just update its content
    this.updateUI();

    this.emit("stateChange", {
      prevState,
      newState,
      metadata: {},
      peerId: this.peerId,
    });

    if (newState === this.states.CONNECTED) {
      clearTimeout(this.connectionTimeout);
      if (!this.startTime) {
        this.startTime = Date.now();
      }
    }
  }

  updateUI() {
    if (!this.container) return;

    // Update container class
    this.container.className = `connection-state state-${this.currentState.toLowerCase()}`;

    // Update status text
    const statusEl = this.container.querySelector(".connection-status");
    if (statusEl) {
      statusEl.textContent = `Status: ${this.getStatusText()}`;
    }
  }

  // Event handling methods
  on(eventName, listener) {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, new Set());
    }
    this.eventListeners.get(eventName).add(listener);
  }

  off(eventName, listener) {
    const listeners = this.eventListeners.get(eventName);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  emit(eventName, data) {
    const listeners = this.eventListeners.get(eventName);
    if (listeners) {
      listeners.forEach((listener) => listener(data));
    }
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (!this.isConnectionHealthy()) {
        this.emit("connectionFailed");
      }
    }, 5000);
  }

  isConnectionHealthy() {
    return this.connected && this.container !== null;
  }

  cleanup() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.eventListeners.clear();
    this.connected = false;
    this.startTime = null;

    // Don't remove or hide the container
    if (this.container) {
      this.container.querySelector(".connection-status").textContent =
        "Status: Disconnected";
      this.container.querySelector(".bitrate").textContent = "Bitrate: -- kbps";
      this.container.querySelector(".duration").textContent = "Duration: 0:00";
    }

    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
  }

  handleVisibilityChange() {
    if (document.visibilityState === "hidden" && this.connected) {
      this.emit("connectionStateChange", {
        type: "visibility",
        visible: false,
      });
    }
  }

  handleBeforeUnload(event) {
    if (this.connected) {
      // Synchronous notification to ensure it's sent before page unload
      this.emit("connectionStateChange", {
        type: "unload",
        immediate: true, // Flag for immediate handling
      });

      // For older browsers, delay unload slightly to ensure message sends
      if (event.type === "beforeunload") {
        event.preventDefault();
        event.returnValue = "";
      }
    }
  }
}
