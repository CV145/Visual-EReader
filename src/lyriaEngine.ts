import { GoogleGenAI } from '@google/genai';

export class LyriaEngine {
    private client: any;
    private session: any;
    private audioCtx: AudioContext | null = null;
    private isPlaying = false;
    private nextPlayTime = 0;
    private isFirstChunk = true;
    private UIStateCallback: ((playing: boolean) => void) | null = null;

    attachCallback(cb: (playing: boolean) => void) {
        this.UIStateCallback = cb;
    }

    constructor() {
        const key = localStorage.getItem('GEMINI_API_KEY');
        if (!key) throw new Error("Gemini API key not found. Please set it in Settings.");
        // Connecting specifically to the v1alpha API to unlock undocumented experimental endpoints natively
        this.client = new GoogleGenAI({ apiKey: key, apiVersion: "v1alpha" });
    }

    async togglePlay(prompt: string): Promise<boolean> {
        if (this.isPlaying) {
             this.stop();
             return false;
        } else {
             await this.start(prompt);
             return this.isPlaying;
        }
    }

    async start(initialPrompt: string) {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
        }
        if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
        this.nextPlayTime = this.audioCtx.currentTime;
        this.isPlaying = true;
        this.isFirstChunk = true;

        try {
            this.session = await this.client.live.music.connect({
                model: "models/lyria-realtime-exp",
                callbacks: {
                    onmessage: (message: any) => this.handleMessage(message),
                    onerror: (error: any) => {
                         console.error("Lyria error:", error);
                         alert("Lyria Socket Error: " + (error.message || JSON.stringify(error)));
                    },
                    onclose: (e: any) => {
                        console.log("Lyria streaming closed. Close event details:", e);
                        this.isPlaying = false;
                        if (this.UIStateCallback) this.UIStateCallback(false);
                    }
                }
            });

            // Set mandatory initial config to strictly format response payload
            await this.session.setMusicGenerationConfig({
                musicGenerationConfig: {
                    bpm: 90,
                    temperature: 1.0
                }
            });

            await this.setPrompts(initialPrompt);
            await this.session.play();
        } catch (err) {
            console.error("Failed to initialize Lyria Engine:", err);
            this.isPlaying = false;
            throw err;
        }
    }

    async setPrompts(prompt: string) {
        if (!this.session || !this.isPlaying) return;
        
        // Push the dynamic sentiment keywords from Flash into Lyria, anchoring them purely to rhythm and texture rules
        const safePrompt = `Instrumental background music, absolutely continuous, no vocals. Keywords: ` + prompt.slice(0, 300);
        
        console.log("🎵 Steering Lyria with prompt:", safePrompt);

        try {
            await this.session.setWeightedPrompts({
                weightedPrompts: [
                   { text: safePrompt, weight: 1.0 }
                ]
            });
        } catch (err) {
            console.error("Failed to push prompt to Lyria:", err);
        }
    }

    stop() {
        this.isPlaying = false;
        if (this.UIStateCallback) this.UIStateCallback(false);
        if (this.session) {
            try {
                this.session.stop();
            } catch(e) {
                // Ignore destruction issues
            }
        }
        if (this.audioCtx) {
            // Hard suspend entire hardware execution context to prevent memory leaks from stranded chunks
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

    warmup() {
        // Unlocks the audio context instantly when called during a click event
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    private decodeAndScheduleChunk(base64Data: string) {
        if (!this.audioCtx) return;

        try {
            // Demultiplex Base64 directly into Native 8-bit memory span explicitly
            const binaryString = window.atob(base64Data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Bind memory boundary cleanly targeting exactly interleaved L-R-L-R
            const dataView = new DataView(bytes.buffer);
            const numSamples = bytes.length / 2; // total 16-bit payload span
            const numFrames = numSamples / 2; // 2 channels (stereo)

            if (numFrames <= 0) return;

            const audioBuffer = this.audioCtx.createBuffer(2, numFrames, 48000);
            const leftChannel = audioBuffer.getChannelData(0);
            const rightChannel = audioBuffer.getChannelData(1);

            for (let i = 0; i < numFrames; i++) {
                // Divide natively by 32768.0 to seamlessly expand range bounds strictly to WebAudio spec [-1.0, 1.0] without integer clipping
                leftChannel[i] = dataView.getInt16(i * 4, true) / 32768.0;
                rightChannel[i] = dataView.getInt16(i * 4 + 2, true) / 32768.0;
            }

            const source = this.audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            
            const currentTime = this.audioCtx.currentTime;
            
            // Queue seamlessly precisely aligned with the conclusion timeline frame mathematically
            if (this.nextPlayTime < currentTime) {
                 if (this.isFirstChunk) {
                     // Initial Deep Buffer: Wait 2.5 seconds before starting the first note 
                     // to absorb all major network jitter and generation latency.
                     this.nextPlayTime = currentTime + 2.5;
                     this.isFirstChunk = false;
                 } else {
                     // Micro-Recovery: If we still manage to underrun mid-song, 
                     // recover almost instantly so the drop-out isn't as noticeable.
                     this.nextPlayTime = currentTime + 0.2;
                 }
            }
            
            source.start(this.nextPlayTime);
            this.nextPlayTime += audioBuffer.duration;
        } catch(err) {
            console.error("Frame decoding failure:", err);
        }
    }
}
