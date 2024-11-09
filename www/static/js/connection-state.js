export class ConnectionState {
  constructor(parentContainer) {
    this.states = {
      CONNECTING: "connecting",
      CONNECTED: "connected",
      FAILED: "failed",
    };
    this.currentState = this.states.CONNECTING;
    this.listeners = new Map();
    this.container = null;
    this.createStatsContainer(parentContainer);
  }

  createStatsContainer(parent) {
    if (!parent || this.container) return;

    this.container = document.createElement("div");
    this.container.className = "stream-stats";
    this.container.style.display = "none";
    this.container.innerHTML = `
      <div class="status">Connecting...</div>
      <div class="bitrate">-- kbps</div>
      <div class="time">0:00</div>
    `;
    parent.appendChild(this.container);
  }

  updateStats({ bitrate, elapsedTime }) {
    if (!this.container || this.currentState !== this.states.CONNECTED) return;

    const minutes = Math.floor(elapsedTime / 60);
    const seconds = Math.floor(elapsedTime % 60);

    this.container.querySelector(".bitrate").textContent =
      `${bitrate.toFixed(1)} kbps`;
    this.container.querySelector(".time").textContent =
      `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  setState(newState) {
    if (this.currentState === newState) return;

    this.currentState = newState;
    if (this.container) {
      this.container.style.display =
        newState === this.states.CONNECTED ? "block" : "none";

      const statusElement = this.container.querySelector(".status");
      if (statusElement) {
        statusElement.textContent =
          newState === this.states.CONNECTED
            ? "Connected"
            : newState === this.states.FAILED
              ? "Failed"
              : "Connecting...";
      }
    }
    this.emit("stateChange", { newState });
  }

  cleanup() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.listeners.clear();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  emit(event, data) {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }
}
