// src/localImageEngine.ts
import { Txt2ImgWorkerClient } from 'web-txt2img';
import { env, AutoTokenizer } from '@xenova/transformers';

// Prevent the tokenizer from looking for local files, forcing it to pull from Hugging Face Hub
env.allowLocalModels = false;

export class ImageGenerator {
  client: Txt2ImgWorkerClient | null = null;

  isModelDownloaded(): boolean {
    return localStorage.getItem('LOCAL_SD_MODEL_CACHED') === 'true';
  }

  async setup(onProgress?: (status: string) => void) {
    if (!this.client) {
      console.log("[Engine] Creating Txt2ImgWorkerClient...");
      this.client = Txt2ImgWorkerClient.createDefault();
    }

    if (onProgress) onProgress("Initializing WebGPU Download...");

    try {
      // 1. Hardware Check
      console.log("[Engine] Detecting environment capabilities...");
      const caps = await this.client.detect();
      console.log("[Engine] Capabilities detected:", caps);
      
      if (!caps.webgpu) {
        throw new Error("WebGPU is not supported in this browser.");
      }

      // 2. Load the Model
      console.log("[Engine] Starting model download for 'sd-turbo'...");
      await this.client.load(
        'sd-turbo', 
        { 
          tokenizer: AutoTokenizer 
        },
        (progress: any) => {
          // --- DIAGNOSTIC LOG ---
          console.log("[Engine] Raw progress event:", progress);
          
          if (onProgress) {
            if (progress.pct != null) {
              onProgress(`Downloading: ${(progress.pct * 100).toFixed(0)}%`);
            } else if (progress.status || progress.phase) {
              onProgress(`Status: ${progress.status || progress.phase}...`);
            } else if (typeof progress === 'string') {
              onProgress(`Status: ${progress}`);
            } else {
              onProgress("Downloading & Caching Model...");
            }
          }
        }
      );
      
      console.log("[Engine] Model load complete!");
      localStorage.setItem('LOCAL_SD_MODEL_CACHED', 'true');
      if (onProgress) onProgress("Download complete!");

    } catch (err) {
      console.error("[Engine] FATAL ERROR during setup:", err);
      if (onProgress) onProgress("Download failed! Check console.");
      throw err;
    }
  }

  async deleteModel() {
    if (this.client) {
      try {
        await this.client.unload();
        await this.client.purgeAll();
      } catch (err) {
        console.warn("Error during model purge:", err);
      }
    }
    localStorage.removeItem('LOCAL_SD_MODEL_CACHED');
  }

  async generateImage(promptText: string): Promise<string> {
    if (!this.client) await this.setup();

    console.log("[Engine] Generating image with prompt:", promptText);
    
    try {
      const { promise } = this.client!.generate({ 
        prompt: promptText,
        seed: Math.floor(Math.random() * 1000000) 
      });
      const result = await promise;

      if (!result.ok || !result.blob) {
        throw new Error(result.error || "Generation failed.");
      }

      console.log("[Engine] Image generated successfully!");
      return await this.blobToBase64(result.blob);
    } catch (err) {
      console.error("[Engine] Generation error:", err);
      throw err;
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error("Failed to read Blob as Base64."));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export const localImageEngine = new ImageGenerator();