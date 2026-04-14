// src/localImageEngine.ts
import { 
  detectCapabilities, 
  loadModel, 
  isModelLoaded, 
  generateImage, 
  purgeAllCaches 
} from 'web-txt2img';
import { env, AutoTokenizer } from '@xenova/transformers';

// Fixes tokenizer loading issues by forcing remote Hugging Face CDN downloads [3, 4]
env.allowLocalModels = false;

export class ImageGenerator {
  isModelDownloaded(): boolean {
    return localStorage.getItem('LOCAL_SD_MODEL_CACHED') === 'true';
  }

  async setup(onProgress?: (status: string) => void) {
    if (onProgress) onProgress("Checking Hardware (WebGPU)...");

    try {
      console.log("[Engine] Detecting environment capabilities...");
      
      // Using Direct API's detectCapabilities [2]
      const caps = await detectCapabilities();
      console.log("[Engine] Capabilities detected:", caps);
      
      if (!caps.webgpu) {
        throw new Error("WebGPU is not supported or enabled in this browser.");
      }

      console.log("[Engine] Starting model download for 'sd-turbo'...");
      
      /// Using Direct API's loadModel (expects 1-2 arguments)
      await loadModel(
        'sd-turbo', 
        { 
          // Injecting the Tokenizer directly (using 'any' cast as before)
          tokenizer: () => AutoTokenizer,
          
          // onProgress goes INSIDE the options object in the base API
          onProgress: (progress: any) => {
            if (onProgress) {
              if (progress.pct != null) {
                onProgress(`Downloading: ${progress.pct.toFixed(0)}%`);
              } else {
                onProgress("Downloading & Caching Model...");
              }
            }
          }
        } as any 
      );
      
      console.log("[Engine] Model load complete!");
      localStorage.setItem('LOCAL_SD_MODEL_CACHED', 'true');
      if (onProgress) onProgress("Download complete!");

    } catch (err) {
      console.error("[Engine] FATAL ERROR during setup:", err);
      if (onProgress) onProgress(`Error: ${err instanceof Error ? err.message : 'Setup failed'}`);
      throw err;
    }
  }

  async generateImage(promptText: string): Promise<string> {
    // Direct API allows us to check loaded state synchronously [2]
    if (!isModelLoaded('sd-turbo')) {
      await this.setup();
    }

    console.log("[Engine] Generating image...");
    try {
      // Using Direct API's generateImage, which requires the model ID explicitly [2, 6]
      const result = await generateImage({ 
        model: 'sd-turbo',
        prompt: promptText,
        seed: Math.floor(Math.random() * 1000000) 
      });

      if (!result.ok || !result.blob) {
        throw new Error((result as any).reason || "Generation failed.");
      }

      return await this.blobToBase64(result.blob);
    } catch (err) {
      console.error("[Engine] Generation error:", err);
      throw err;
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async deleteModel() {
    // Purges cache directly [2]
    await purgeAllCaches();
    localStorage.removeItem('LOCAL_SD_MODEL_CACHED');
  }
}

export const localImageEngine = new ImageGenerator();