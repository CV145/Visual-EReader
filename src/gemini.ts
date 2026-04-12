import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';

const getClient = () => {
  const key = localStorage.getItem('GEMINI_API_KEY');
  if (!key) throw new Error("Gemini API key not found. Please set it in Settings.");
  return new GoogleGenAI({ apiKey: key });
};

export async function generateAmbientImage(promptContext: string, characterContext?: string): Promise<string> {
  const ai = getClient();
  
  const includeCharacters = localStorage.getItem('INCLUDE_CHARACTERS') === 'true';
  const stylePref = localStorage.getItem('IMAGE_STYLE_PREF') || 'cinematic';
  
  // Force characters to be included if the style is "character-portraits"
  const forceCharacters = stylePref === 'character-portraits';
  
  const characterDirective = (includeCharacters || forceCharacters)
    ? "Include any characters described in the scene."
    : "Do NOT include any characters, people, or figures. Focus ONLY on the environment, landscape, architecture, and atmospheric setting.";

  let styleDirective = "Generate a 1st person Point of View (POV) cinematic masterpiece, photorealistic 8k resolution image. The viewpoint should be from the absolute perspective of the main character looking out at the world dynamically in front of them, like real life or a highly realistic movie scene.";
  if (stylePref === 'manga') {
      styleDirective = "Generate an anime-style black and white manga page full of panels representing the story excerpt. High quality 2D hand drawn manga art style.";
  } else if (stylePref === 'tabletop') {
      styleDirective = "Generate a top-down 2D tabletop map view of the scene. The viewpoint should be looking down at a tabletop map. Any characters must be depicted as tiny plastic or resin minifigures with a small floating nameplate or text base showing their name next to them.";
  } else if (stylePref === 'comic-book') {
      styleDirective = "Generate a graphic novel page showing several different comic book panels/cells representing the sequence of events and environment described in this story excerpt. Comic book art style.";
  } else if (stylePref === 'character-portraits') {
      styleDirective = "Generate a character concept art sheet featuring character portraits for the characters present in the excerpt. Each portrait MUST include a fully rendered, contextual background behind the character that fits the scene's environment or their persona. For each character depicted, clearly place the name of the character next to their portrait. Use a cohesive, high-quality character design art style.";
  }

  const environmentSuffix = (includeCharacters || forceCharacters) ? "" : " No people, no characters, no figures. Environment only.";
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
          responseModalities: ["IMAGE"],
          safetySettings: [
            {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            }
          ]
      }
    });

    const firstCandidate = imageResponse.candidates?.[0];

    // Explicitly check for API safety blocks
    if (imageResponse.promptFeedback?.blockReason === 'SAFETY' || firstCandidate?.finishReason === 'SAFETY') {
        throw new Error("SAFETY_BLOCKED");
    }


    const imagePart = firstCandidate?.content?.parts?.[0];
    const base64Image = imagePart?.inlineData?.data;
    
    if (!base64Image) {
        console.error("Unknown image response structure:", imageResponse);
        throw new Error("Flash returned a response, but couldn't parse the image data.");
    }

    return `data:image/jpeg;base64,${base64Image}`;
  } catch (error) {
    console.error("Error generating image:", error);
    if (error.message?.includes("SAFETY_BLOCKED") || error.message?.toLowerCase().includes("safety")) {
        throw new Error("SAFETY_BLOCKED");
    }
    throw error;
  }
}

export async function analyzeMusicalSentiment(paragraphsText: string, anchorGenre: string): Promise<string> {
   const ai = getClient();
   
   const systemPrompt = `You are a Story Analyst. Your job is to analyze the following 100-paragraph story excerpt and summarize its core emotional tone and trajectory.
   The overall book genre is: "${anchorGenre}".
   
   Output a concise description of the emotions felt in the scene. DO NOT mention specific instruments, tempos, or musical terms. Just describe the emotional vibe and append the genre.
   
   Format example: "Tense, building dread, sudden realization, melancholic acceptance. Genre: ${anchorGenre}"
   
   Story Excerpt:
   "${paragraphsText}"`;

   try {
       const response = await ai.models.generateContent({
           model: 'gemini-2.5-flash',
           contents: systemPrompt
       });
       
       const text = response.text?.trim() || `Emotional tone for ${anchorGenre}`;
       console.log("Sentiment Generated (Anchored):", text);
       return text;
   } catch (error) {
       console.error("Error analyzing emotional sentiment:", error);
       return `Emotional tone for ${anchorGenre}`; // Safe fallback
   }
}

export async function detectOverallGenre(excerpt: string): Promise<string> {
  const ai = getClient();
  const prompt = `Analyze the following story excerpt and determine the single most appropriate overarching MUSICAL GENRE/STYLE for its background soundtrack. 
  Output ONLY the genre name (2-3 words, e.g., "Atmospheric Western", "Orchestral Fantasy", "Industrial Cyberpunk", "Regency Piano Noir").
  Focus on the setting, period, and tone.
  
  Excerpt:
  "${excerpt.slice(0, 3000)}"`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });
    return response.text?.trim() || "Ambient Cinematic";
  } catch (err) {
    console.error("Error detecting overall genre:", err);
    return "Ambient Cinematic";
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
   Story Excerpt: "${paragraphsText.slice(0, 15000)}"`; // Increased slice to handle 25 paragraphs
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