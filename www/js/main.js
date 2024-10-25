class AudioDecayClient {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('connect').addEventListener('click', () => this.connect());
        document.getElementById('disconnect').addEventListener('click', () => this.disconnect());
    }

    connect() {
        if (this.ws) {
            return;
        }

        this.ws = new WebSocket(`ws://${window.location.host}/ws`);
        
        this.ws.onopen = () => {
            this.connected = true;
            this.updateUI();
            console.log('Connected to server');
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
        };

        this.ws.onclose = () => {
            this.connected = false;
            this.ws = null;
            this.updateUI();
            console.log('Disconnected from server');
        };
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }

    updateUI() {
        document.getElementById('connect').disabled = this.connected;
        document.getElementById('disconnect').disabled = !this.connected;
        document.getElementById('status').textContent = 
            this.connected ? 'Connected' : 'Disconnected';
    }

    handleMessage(message) {
        console.log('Received message:', message);
        // Handle different message types here
    }
}

// Initialize the client when the page loads
window.addEventListener('load', () => {
    window.client = new AudioDecayClient();
});
