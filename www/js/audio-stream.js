class AudioStreamManager {
    constructor() {
        this.stream = null;
        this.audioContext = null;
        this.peerConnection = null;
    }

    async initializeStream() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                audio: true, 
                video: false 
            });
            this.audioContext = new AudioContext();
            return true;
        } catch (error) {
            console.error('Error accessing microphone:', error);
            return false;
        }
    }

    async connectToPeer(targetUserId) {
        if (!this.stream) {
            const initialized = await this.initializeStream();
            if (!initialized) return false;
        }

        this.peerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        // Add audio track to the connection
        this.stream.getAudioTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.stream);
        });

        return this.peerConnection;
    }

    async createOffer() {
        if (!this.peerConnection) return null;
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        return offer;
    }

    async handleAnswer(answer) {
        if (!this.peerConnection) return;
        await this.peerConnection.setRemoteDescription(answer);
    }

    async handleIceCandidate(candidate) {
        if (!this.peerConnection) return;
        await this.peerConnection.addIceCandidate(candidate);
    }

    disconnect() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}

export default AudioStreamManager;
