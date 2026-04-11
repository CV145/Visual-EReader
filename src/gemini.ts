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

  // Fetch Style Preferences
  const stylePref = localStorage.getItem('IMAGE_STYLE_PREF') || 'cinematic';
  
  let styleDirective = "Generate a cinematic, masterpiece, 8k resolution, photorealistic image of the environment described in this story excerpt.";
  if (stylePref === 'visual-novel') {
      styleDirective = "Generate an anime-style 1st person Point of View (POV) visual novel background representing the environment described in this story excerpt. High quality 2D anime art style.";
  } else if (stylePref === 'tabletop') {
      styleDirective = "Generate a top-down tabletop miniature diorama style image representing the scene. The viewpoint should be looking down at a tabletop map. Any characters must be depicted as tiny plastic or resin minifigures with a small floating nameplate or text base showing their name next to them.";
  } else if (stylePref === 'comic-book') {
      styleDirective = "Generate a graphic novel page showing several different comic book panels/cells representing the sequence of events and environment described in this story excerpt. Comic book art style.";
  }

  // Create a direct prompt to the multimodal model
  const environmentSuffix = includeCharacters ? "" : " No people, no characters, no figures. Environment only.";
  const directPrompt = `${styleDirective}. Emphasize lighting, atmosphere, and colors. ${characterDirective}${environmentSuffix}\n\nStory Excerpt:\n"${promptContext}"`;

  console.log("------- SENDING TO GEMINI -------");
  console.log(directPrompt);
  console.log("---------------------------------");

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
