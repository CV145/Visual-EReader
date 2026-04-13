// src/imageEngine.ts
export class LocalImageEngine {
  worker: Worker | null = null;
  onProgress?: (msg: string) => void;

  constructor(onProgress?: (msg: string) => void) {
    this.onProgress = onProgress;
  }

  async init() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' });
    }
    return new Promise<void>((resolve, reject) => {
      const initHandler = (e: MessageEvent) => {
        if (e.data.status === 'loading' && this.onProgress) {
          this.onProgress(e.data.message);
        } else if (e.data.status === 'ready') {
          this.worker!.removeEventListener('message', initHandler);
          resolve();
        } else if (e.data.status === 'error') {
          this.worker!.removeEventListener('message', initHandler);
          reject(e.data.message);
        }
      };
      this.worker!.addEventListener('message', initHandler);
      this.worker!.postMessage({ action: 'load' });
    });
  }

  async generate(prompt: string): Promise<string> {
    if (!this.worker) await this.init();
    return new Promise((resolve, reject) => {
      const handler = (e: MessageEvent) => {
        if (e.data.status === 'generating' && this.onProgress) {
          this.onProgress(e.data.message);
        } else if (e.data.status === 'complete') {
          this.worker!.removeEventListener('message', handler);
          
          // Convert Blob -> Base64 so it can be saved in LocalForage/DB
          const reader = new FileReader();
          reader.readAsDataURL(e.data.image);
          reader.onloadend = () => {
             resolve(reader.result as string);
          };
        } else if (e.data.status === 'error') {
          this.worker!.removeEventListener('message', handler);
          reject(e.data.message);
        }
      };
      this.worker!.addEventListener('message', handler);
      this.worker!.postMessage({ action: 'generate', prompt });
    });
  }
}