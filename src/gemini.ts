import { GoogleGenAI } from '@google/genai';

const getClient = () => {
  const key = localStorage.getItem('GEMINI_API_KEY');
  if (!key) throw new Error("Gemini API key not found. Please set it in Settings.");
  return new GoogleGenAI({ apiKey: key });
};

export async function generateAmbientImage(promptContext: string): Promise<string> {
  const ai = getClient();
  
  // Create a visual prompt describing the scene
  const summarizePrompt = `You are visualizing a scene from a book. Based on the following text context, write a highly descriptive, cinematic, beautiful image generation prompt (max 2 sentences). Emphasize lighting, atmosphere, colors, and the main subject. \n\nContext:\n"${promptContext}"`;

  try {
    const chatResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: summarizePrompt,
    });
    
    // Fallback prompt if Gemini text generation fails
    const visualPromptText = chatResponse.text || "A beautiful ambient atmospheric scene.";
    const visualPrompt = visualPromptText + " masterpiece, high quality, cinematic lighting, 8k resolution, photorealistic, intricate details";
    
    const imageResponse = await ai.models.generateImages({
      model: 'gemini-2.5-flash-image',
      prompt: visualPrompt,
      config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: '3:4'
      }
    });

    const base64Image = imageResponse.generatedImages[0].image.imageBytes;
    return `data:image/jpeg;base64,${base64Image}`;
  } catch (error) {
    console.error("Error generating image:", error);
    throw error;
  }
}
