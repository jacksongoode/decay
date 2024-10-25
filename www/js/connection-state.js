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
    this.currentState = this.states.INITIALIZING;
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
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    
    // Enhanced unload handling
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    window.addEventListener('unload', this.handleBeforeUnload);
    window.addEventListener('pagehide', this.handleBeforeUnload);
    
    this.startHeartbeat();
  }

  createContainer(parentContainer) {
    const container = document.createElement("div");
    container.className = `connection-state state-${this.currentState}`;
    container.id = `connection-${this.peerId}`;
    container.innerHTML = `
      <div class="stream-stats">
        <h3>User ${this.peerId}</h3>
        <div class="connection-status">Status: ${this.getStatusText()}</div>
        <div class="bitrate">Bitrate: -- kbps</div>
        <div class="duration">Duration: 0:00</div>
      </div>
    `;
    parentContainer.appendChild(container);
    return container;
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

  setState(newState, metadata = {}) {
    if (!this.container) return;

    const prevState = this.currentState;
    this.currentState = newState;
    this.connected = newState === this.states.CONNECTED;

    if (this.connected && !this.startTime) {
      this.startTime = Date.now();
    }

    this.updateUI();
    
    // Ensure state change is emitted
    this.emit("stateChange", { 
      prevState, 
      newState, 
      metadata,
      peerId: this.peerId 
    });

    // Clear timeout if connection succeeds
    if (newState === this.states.CONNECTED) {
      clearTimeout(this.connectionTimeout);
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
    // Clear all event listeners
    this.eventListeners.clear();

    // Reset state
    this.connected = false;
    this.startTime = null;

    // Remove DOM element
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }

    // Remove event listeners
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
  }

  handleVisibilityChange() {
    if (document.visibilityState === 'hidden' && this.connected) {
      this.emit('connectionStateChange', { 
        type: 'visibility',
        visible: false 
      });
    }
  }

  handleBeforeUnload(event) {
    if (this.connected) {
      // Synchronous notification to ensure it's sent before page unload
      this.emit('connectionStateChange', { 
        type: 'unload',
        immediate: true  // Flag for immediate handling
      });
      
      // For older browsers, delay unload slightly to ensure message sends
      if (event.type === 'beforeunload') {
        event.preventDefault();
        event.returnValue = '';
      }
    }
  }
}
