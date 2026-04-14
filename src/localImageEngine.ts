// src/localImageEngine.ts
import { 
  detectCapabilities, 
  loadModel, 
  isModelLoaded, 
  generateImage, 
  purgeAllCaches 
} from 'web-txt2img';
import { env } from '@xenova/transformers';

// Fixes tokenizer loading issues by forcing remote Hugging Face CDN downloads
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false;

// --- THE SLEDGEHAMMER: GLOBAL BIGINT PATCH ---
// web-txt2img's internal code uses Int32Array.from() on tokenizer outputs.
// Transformers.js v3 outputs BigInts. JavaScript crashes when combining the two.
// This globally intercepts that exact crash and seamlessly converts BigInts to Numbers.
const originalInt32ArrayFrom = Int32Array.from;
(Int32Array as any).from = function(source: any, mapFn?: any, thisArg?: any) {
  // If the source is an array containing BigInts, intercept and sanitize it
  if (source && source.length > 0 && typeof source[0] === 'bigint') {
    const safeArray = Array.from(source).map(val => Number(val));
    return originalInt32ArrayFrom.call(this, safeArray, mapFn, thisArg);
  }
  // Otherwise, let it behave exactly as normal
  return originalInt32ArrayFrom.call(this, source, mapFn, thisArg);
};
// ---------------------------------------------

export class ImageGenerator {
  isModelDownloaded(): boolean {
    return localStorage.getItem('LOCAL_SD_MODEL_CACHED') === 'true';
  }

  async setup(onProgress?: (status: string) => void) {
    if (onProgress) onProgress("Checking Hardware (WebGPU)...");

    try {
      console.log("[Engine] Detecting environment capabilities...");
      
      const caps = await detectCapabilities();
      console.log("[Engine] Capabilities detected:", caps);
      
      if (!caps.webgpu) {
        throw new Error("WebGPU is not supported or enabled in this browser.");
      }

      console.log("[Engine] Starting model preparation for 'sd-turbo'...");

      const isAlreadyCached = this.isModelDownloaded();
      
      // Using Direct API's loadModel
      await loadModel(
        'sd-turbo', 
        { 
          // We removed the messy tokenizer injections! 
          // The library will use its internal tokenizer, and our global patch will protect it.

          wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/',
          backendPreference: ['webgpu'],
          
          onProgress: (progress: any) => {
            if (onProgress) {
              const actionText = isAlreadyCached ? "Loading into GPU Memory" : "Downloading from Internet";
              if (progress.pct != null) {
                onProgress(`${actionText}: ${progress.pct.toFixed(0)}%`);
              } else {
                onProgress(`${actionText}...`);
              }
            }
          }
        } as any 
      );

      if (!isModelLoaded('sd-turbo')) {
        throw new Error("Backend crashed during initialization. Model is not loaded.");
      }
      
      console.log("[Engine] Model load complete!");
      localStorage.setItem('LOCAL_SD_MODEL_CACHED', 'true');
      if (onProgress) onProgress("Ready!");

    } catch (err) {
      console.error("[Engine] FATAL ERROR during setup:", err);
      if (onProgress) onProgress(`Error: ${err instanceof Error ? err.message : 'Setup failed'}`);
      throw err;
    }
  }

  async generateImage(promptText: string): Promise<string> {
    if (!isModelLoaded('sd-turbo')) {
      await this.setup();
    }

    console.log("[Engine] Generating image...");
    /*try {
      const result = await generateImage({ 
        model: 'sd-turbo',
        prompt: promptText,
        width: 512,
        height: 512,
        seed: Math.floor(Math.random() * 1000000) 
      });*/
      try {
      // Cast to 'any' to bypass strict TypeScript checks for num_inference_steps
      const genParams: any = {
        model: 'sd-turbo',
        prompt: promptText,
        width: 512,
        height: 512,
        num_inference_steps: 2, // Reduces VRAM spike significantly
        seed: Math.floor(Math.random() * 1000000)
      };

      const result = await generateImage(genParams);

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
    await purgeAllCaches();
    localStorage.removeItem('LOCAL_SD_MODEL_CACHED');
  }
}

export const localImageEngine = new ImageGenerator();