// Used to keep the UI from freezing by offloading to a Web Worker

import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// A handler that communicates with the main thread
const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
    handler.onmessage(msg);
}

