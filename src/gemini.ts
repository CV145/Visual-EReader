import { GoogleGenAI } from '@google/genai';

const getClient = () => {
  const key = localStorage.getItem('GEMINI_API_KEY');
  if (!key) throw new Error("Gemini API key not found. Please set it in Settings.");
  return new GoogleGenAI({ apiKey: key });
};

export async function generateAmbientImage(promptContext: string): Promise<string> {
  const ai = getClient();
  
  // Check if user wants characters in the image
  const includeCharacters = localStorage.getItem('INCLUDE_CHARACTERS') === 'true';
  
  const characterDirective = includeCharacters
    ? "Include any characters described in the scene."
    : "Do NOT include any characters, people, or figures. Focus ONLY on the environment, landscape, architecture, and atmospheric setting.";

  // Create a direct prompt to the multimodal model
  const environmentSuffix = includeCharacters ? "" : " No people, no characters, no figures. Environment only.";
  const directPrompt = `Generate a cinematic, masterpiece, 8k resolution, photorealistic image of the environment described in this story excerpt. Emphasize lighting, atmosphere, and colors. ${characterDirective}${environmentSuffix}\n\nStory Excerpt:\n"${promptContext}"`;

  try {
    const imageResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: directPrompt,
      config: {
          responseModalities: ["IMAGE"]
      }
    });

    const firstCandidate = imageResponse.candidates?.[0];
    const imagePart = firstCandidate?.content?.parts?.[0];
    const base64Image = imagePart?.inlineData?.data;
    
    if (!base64Image) {
        console.error("Unknown image response structure:", imageResponse);
        throw new Error("Flash returned a response, but couldn't parse the image data.");
    }

    return `data:image/jpeg;base64,${base64Image}`;
  } catch (error) {
    console.error("Error generating image:", error);
    throw error;
  }
}
