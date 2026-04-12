import { GoogleGenAI } from '@google/genai';

/**
 * AmbientEngine — A second, independent Lyria Real-Time stream dedicated
 * exclusively to environmental sound design (wind, rain, birdsong, etc.).
 * Runs in parallel with LyriaEngine (music) and can be toggled independently.
 */
export class AmbientEngine {
    private client: any;
    private session: any;
    private audioCtx: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private isPlaying = false;
    private nextPlayTime = 0;
    private UIStateCallback: ((playing: boolean) => void) | null = null;
    private _volume = 0.6; // Default ambient volume (slightly quieter than music)

    constructor() {
        const key = localStorage.getItem('GEMINI_API_KEY');
        if (!key) throw new Error("Gemini API key not found. Please set it in Settings.");
        this.client = new GoogleGenAI({ apiKey: key, apiVersion: "v1alpha" });
    }

    attachCallback(cb: (playing: boolean) => void) {
        this.UIStateCallback = cb;
    }

    get volume() { return this._volume; }

    setVolume(vol: number) {
        this._volume = Math.max(0, Math.min(1, vol));
        if (this.gainNode) this.gainNode.gain.setTargetAtTime(this._volume, this.audioCtx!.currentTime, 0.1);
    }

    async togglePlay(ambientPrompt: string): Promise<boolean> {
        if (this.isPlaying) {
            this.stop();
            return false;
        } else {
            await this.start(ambientPrompt);
            return this.isPlaying;
        }
    }

    async start(ambientPrompt: string) {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
        }
        if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();

        // Create a gain node for volume control
        this.gainNode = this.audioCtx.createGain();
        this.gainNode.gain.value = this._volume;
        this.gainNode.connect(this.audioCtx.destination);

        this.nextPlayTime = this.audioCtx.currentTime;
        this.isPlaying = true;

        try {
            this.session = await this.client.live.music.connect({
                model: "models/lyria-realtime-exp",
                callbacks: {
                    onmessage: (message: any) => this.handleMessage(message),
                    onerror: (error: any) => {
                        console.error("Ambient engine error:", error);
                    },
                    onclose: (e: any) => {
                        console.log("Ambient stream closed:", e);
                        this.isPlaying = false;
                        if (this.UIStateCallback) this.UIStateCallback(false);
                    }
                }
            });

            await this.session.setMusicGenerationConfig({
                musicGenerationConfig: { bpm: 60, temperature: 1.1 }
            });

            await this.setAmbience(ambientPrompt);
            await this.session.play();
        } catch (err) {
            console.error("Failed to initialize Ambient Engine:", err);
            this.isPlaying = false;
            throw err;
        }
    }

    async setAmbience(description: string) {
        if (!this.session || !this.isPlaying) return;

        // Force sound-design-only output — no musical instruments, just environmental textures
        const safePrompt = `Pure environmental ambient sound design only. Absolutely NO musical instruments, NO melody, NO rhythm, NO beat, NO bass. Only natural textures: ${description.slice(0, 300)}. Continuous, seamless, atmospheric soundscape.`;

        try {
            await this.session.setWeightedPrompts({
                weightedPrompts: [{ text: safePrompt, weight: 1.0 }]
            });
        } catch (err) {
            console.error("Failed to push ambient prompt:", err);
        }
    }

    stop() {
        this.isPlaying = false;
        if (this.UIStateCallback) this.UIStateCallback(false);
        if (this.session) {
            try { this.session.stop(); } catch(e) {}
        }
        if (this.gainNode) { this.gainNode.disconnect(); this.gainNode = null; }
        if (this.audioCtx) {
            this.audioCtx.suspend();
            this.audioCtx = null;
        }
    }

    private handleMessage(message: any) {
        if (!this.isPlaying || !this.audioCtx) return;
        if (message.serverContent?.audioChunks) {
            for (const chunk of message.serverContent.audioChunks) {
                this.decodeAndScheduleChunk(chunk.data);
            }
        }
    }

    private decodeAndScheduleChunk(base64Data: string) {
        if (!this.audioCtx || !this.gainNode) return;
        try {
            const binaryString = window.atob(base64Data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) { bytes[i] = binaryString.charCodeAt(i); }

            const dataView = new DataView(bytes.buffer);
            const numFrames = bytes.length / 4; // stereo 16-bit

            if (numFrames <= 0) return;

            const audioBuffer = this.audioCtx.createBuffer(2, numFrames, 48000);
            const leftChannel = audioBuffer.getChannelData(0);
            const rightChannel = audioBuffer.getChannelData(1);
            for (let i = 0; i < numFrames; i++) {
                leftChannel[i] = dataView.getInt16(i * 4, true) / 32768.0;
                rightChannel[i] = dataView.getInt16(i * 4 + 2, true) / 32768.0;
            }

            const source = this.audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.gainNode); // Route through gain for volume control

            const currentTime = this.audioCtx.currentTime;
            if (this.nextPlayTime < currentTime) this.nextPlayTime = currentTime + 0.1;
            source.start(this.nextPlayTime);
            this.nextPlayTime += audioBuffer.duration;
        } catch(err) {
            console.error("Ambient frame decoding failure:", err);
        }
    }
}
