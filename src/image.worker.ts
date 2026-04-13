// src/image.worker.ts
import { AutoProcessor, MultiModalityCausalLM } from "@huggingface/transformers";

let processor: any = null;
let model: any = null;

async function loadModel(callback: (msg: any) => void) {
    if (processor && model) return;
    callback({ status: "loading", message: "Loading processor..." });
    const model_id = "onnx-community/Janus-1.3B-ONNX";
    
    processor = await AutoProcessor.from_pretrained(model_id);
    
    // As per the transformers.js maintainers, mapping these dtypes unlocks WebGPU memory bounds correctly
    callback({ status: "loading", message: "Loading model (WebGPU)... this takes a minute on first run." });
    model = await MultiModalityCausalLM.from_pretrained(model_id, {
        device: "webgpu",
        dtype: {
            prepare_inputs_embeds: "q4",
            language_model: "q4f16",
            lm_head: "fp16",
            gen_head: "fp16",
            gen_img_embeds: "fp16",
            image_decode: "fp32",
        }
    });
    callback({ status: "ready", message: "Model Ready" });
}

self.onmessage = async (e: MessageEvent) => {
    const { action, prompt } = e.data;
    
    if (action === "load") {
        await loadModel((msg) => self.postMessage(msg));
    }
    
    if (action === "generate") {
        if (!processor || !model) {
            self.postMessage({ status: "error", message: "Model not loaded. Call load first." });
            return;
        }
        
        self.postMessage({ status: "generating", message: "Generating image..." });
        
        try {
            const conversation = [
                { role: "User", content: prompt }
            ];
            
            const inputs = await processor(conversation, { chat_template: "text_to_image" });
            const num_image_tokens = processor.num_image_tokens;
            
            const outputs = await model.generate_images({
                ...inputs,
                min_new_tokens: num_image_tokens,
                max_new_tokens: num_image_tokens,
                do_sample: true,
            });
            
            // Extract the generated Image object and convert to binary Blob
            const blob = await outputs[0].toBlob();
            
            self.postMessage({ status: "complete", image: blob });
            
        } catch (error: any) {
            self.postMessage({ status: "error", message: error.message });
        }
    }
};