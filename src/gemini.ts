import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';

const getClient = () => {
  const key = localStorage.getItem('GEMINI_API_KEY');
  if (!key) throw new Error("Gemini API key not found. Please set it in Settings.");
  return new GoogleGenAI({ apiKey: key });
};

export async function consolidateCharacterProfiles(
  oldData: { description: string; profile: string },
  newData: { description: string; profile: string }
): Promise<{ description: string; profile: string }> {
  const ai = getClient();
  const prompt = `You are a meticulous Story Editor. You have an existing character record and new details from a recent chapter. 
  Consolidate them into a single, cohesive character profile.
  - Merge the physical descriptions into one concise, consistent appearance summary.
  - Merge the biographical lore and roles into one cohesive narrative summary.
  - Remove all redundancies and duplicate facts.
  - Do NOT invent new details.
  - EXTREMELY IMPORTANT: The finalized "description" MUST BE STRICTLY UNDER 250 WORDS.
  - EXTREMELY IMPORTANT: The finalized "profile" MUST BE STRICTLY UNDER 250 WORDS.
  
  EXISTING RECORD:
  Physical Appearance: "${oldData.description}"
  Biography/Lore: "${oldData.profile}"

  NEW DETAILS TO INTEGRATE:
  Physical Appearance: "${newData.description}"
  Biography/Lore: "${newData.profile}"
  
  Output ONLY a valid JSON object with "description" and "profile" fields. No preamble, no markdown code blocks.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });
    const raw = (response.text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(raw);
    return {
      description: parsed.description || `${oldData.description}. ${newData.description}`.trim(),
      profile: parsed.profile || `${oldData.profile}. ${newData.profile}`.trim()
    };
  } catch (error) {
    console.error("Error consolidating character profiles:", error);
    return {
      description: `${oldData.description}${newData.description ? '. ' + newData.description : ''}`.trim(),
      profile: `${oldData.profile}${newData.profile ? '. ' + newData.profile : ''}`.trim()
    };
  }
}

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
      styleDirective = "Generate a top-down 2D tabletop map view of the scene. The viewpoint should be looking down at a tabletop map. Any characters must be depicted as tiny tokens with a small floating nameplate or text base showing their name next to them.";
  } else if (stylePref === 'comic-book') {
      styleDirective = "Generate a graphic novel page showing several different comic book panels/cells representing the sequence of events and environment described in this story excerpt. Comic book art style.";
  } else if (stylePref === 'pixel-art') {
      styleDirective = "Generate a 2D pixel art image of the scene. The viewpoint should be 2D side-scroller perspective. There can be multiple 'floors' depicting different scenes";
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
  profile?: string;
}

export async function extractCharacterProfiles(paragraphsText: string): Promise<ExtractedCharacter[]> {
   const ai = getClient();
   const prompt = `You are a meticulous Character Designer reading a story. Extract all NAMED characters (use ONLY their first name, no last names allowed).
   Output ONLY a valid JSON array with objects having "name", "description", and "profile" fields. 
   "description" = physical appearance ONLY (hair, eyes, skin, build, clothing). Do NOT include personality here.
   "profile" = Who the character is, their personality, background, and role in the story.
   If none found, output []. No text outside the JSON array.
   Story Excerpt: "${paragraphsText.slice(0, 15000)}"`;
   
   try {
       const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
       const raw = (response.text || '[]').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
       let parsed = JSON.parse(raw);
       
       if (Array.isArray(parsed)) {
           // Programmatic failsafe: forcefully strip anything after the first space
           return parsed.map(c => ({
               name: c.name ? c.name.trim().split(/\s+/)[0] : '',
               description: c.description || '',
               profile: c.profile || ''
           })) as ExtractedCharacter[];
       }
       return [];
   } catch (error) {
       console.error("Error extracting character profiles:", error);
       return [];
   }
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
}

export interface Quiz {
  questions: QuizQuestion[];
}

export async function generateQuiz(contextText: string): Promise<Quiz> {
  const ai = getClient();
  const prompt = `You are a Reading Comprehension Teacher. Based on the following story excerpt, generate a 1-question multiple-choice quiz.
  The question MUST ALWAYS be EXACTLY: "What were the last 25 paragraphs about?"
  You must provide exactly 5 options. One of the options must be the correct summary of the excerpt, and the other 4 must be plausible but incorrect summaries.
  Indicate the correct answer using a 0-based index (0, 1, 2, 3, or 4).
  Output ONLY a valid JSON object matching this schema:
  {
    "questions": [
      {
        "question": "What were the last 25 paragraphs about?",
        "options": ["Option A", "Option B", "Option C", "Option D", "Option E"],
        "answerIndex": 0
      }
    ]
  }
  Do not include any other text, preamble, or markdown formatting outside the JSON object.

  Story Excerpt:
  "${contextText}"`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    const raw = (response.text || '{}').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(raw);
    
    if (parsed && Array.isArray(parsed.questions) && parsed.questions.length === 1 && parsed.questions[0].options.length === 5) {
      return parsed as Quiz;
    } else {
      throw new Error("Invalid quiz format returned by AI.");
    }
  } catch (error) {
    console.error("Error generating quiz:", error);
    // Fallback if AI fails
    return {
      questions: [
        {
          question: "What were the last 25 paragraphs about?",
          options: [
            "A technical error occurred in the simulation.",
            "The characters sat in silence.",
            "I couldn't generate the summary. API Error.",
            "Everyone fell asleep.",
            "They went on a long journey."
          ],
          answerIndex: 2
        }
      ]
    };
  }
}