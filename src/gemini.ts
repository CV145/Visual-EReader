import { GoogleGenAI } from '@google/genai';

const getClient = () => {
  const key = localStorage.getItem('GEMINI_API_KEY');
  if (!key) throw new Error("Gemini API key not found. Please set it in Settings.");
  return new GoogleGenAI({ apiKey: key });
};

export async function generateAmbientImage(promptContext: string, characterContext?: string): Promise<string> {
  const ai = getClient();
  
  // Check if user wants characters in the image
  const includeCharacters = localStorage.getItem('INCLUDE_CHARACTERS') === 'true';
  
  const characterDirective = includeCharacters
    ? "Include any characters described in the scene."
    : "Do NOT include any characters, people, or figures. Focus ONLY on the environment, landscape, architecture, and atmospheric setting.";

  // Fetch Style Preferences
  const stylePref = localStorage.getItem('IMAGE_STYLE_PREF') || 'cinematic';
  
  let styleDirective = "Generate a 1st person Point of View (POV) cinematic masterpiece, photorealistic 8k resolution image. The viewpoint should be from the absolute perspective of the main character looking out at the world dynamically in front of them, like real life or a highly realistic movie scene.";
  if (stylePref === 'visual-novel') {
      styleDirective = "Generate an anime-style 1st person Point of View (POV) visual novel background representing the environment described in this story excerpt. High quality 2D anime art style.";
  } else if (stylePref === 'tabletop') {
      styleDirective = "Generate a top-down tabletop miniature diorama style image representing the scene. The viewpoint should be looking down at a tabletop map. Any characters must be depicted as tiny plastic or resin minifigures with a small floating nameplate or text base showing their name next to them.";
  } else if (stylePref === 'comic-book') {
      styleDirective = "Generate a graphic novel page showing several different comic book panels/cells representing the sequence of events and environment described in this story excerpt. Comic book art style.";
  }

  // Create a direct prompt to the multimodal model
  const environmentSuffix = includeCharacters ? "" : " No people, no characters, no figures. Environment only.";
  const characterSheet = characterContext ? `\n\nKnown Character Appearances (maintain strict visual consistency):\n${characterContext}` : '';
  const directPrompt = `${styleDirective}. Emphasize lighting, atmosphere, and colors. ${characterDirective}${environmentSuffix}${characterSheet}\n\nStory Excerpt:\n"${promptContext}"`;

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

export async function analyzeMusicalSentiment(paragraphsText: string): Promise<string> {
   const ai = getClient();
   
   const systemPrompt = `You are a talented Cinematic Soundtrack Director. Your job is to analyze the following story excerpt and determine the PERFECT background music for the scene.
   Output EXACTLY one single line of comma-separated musical keywords describing the genre, mood, tempo, and instruments. 
   Do NOT output conversational text, explanations, or quotes. Do NOT include lyrics or vocals. 
   Examples of valid outputs:
   - "Fast-paced tension, intense orchestral strings, racing heartbeat, dark gritty rock, heavy electric guitar"
   - "Calm, ambient drones, ethereal choir, very slow tempo, relaxing, mystical"
   - "Upbeat, cheerful pop, bouncy piano, light acoustic guitar, rhythmic"
   
   Story Excerpt:
   "${paragraphsText}"`;

   try {
       const response = await ai.models.generateContent({
           model: 'gemini-2.5-flash',
           contents: systemPrompt
       });
       
       const text = response.text || "ambient background music, cinematic";
       console.log("Sentiment Generated:", text);
       return text;
   } catch (error) {
       console.error("Error analyzing musical sentiment:", error);
       return "ambient background music, calm, cinematic"; // Safe fallback
   }
}

export interface ExtractedCharacter {
  name: string;
  description: string;
}

export async function extractCharacterProfiles(paragraphsText: string): Promise<ExtractedCharacter[]> {
   const ai = getClient();
   const prompt = `You are a meticulous Character Designer reading a story. Extract all NAMED characters and describe their physical appearance only.
   Output ONLY a valid JSON array with objects having "name" and "description" fields. "description" = physical appearance ONLY (hair, eyes, skin, build, clothing). If none found, output []. No text outside the JSON array.
   Story Excerpt: "${paragraphsText.slice(0, 2000)}"`;
   try {
       const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
       const raw = (response.text || '[]').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
       const parsed = JSON.parse(raw);
       if (Array.isArray(parsed)) return parsed as ExtractedCharacter[];
       return [];
   } catch (error) {
       console.error("Error extracting character profiles:", error);
       return [];
   }
}
