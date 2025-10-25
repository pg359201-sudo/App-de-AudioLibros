import { GoogleGenAI, Modality, GenerateContentResponse } from "@google/genai";
import { ResponseMode } from '../types';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const getAnalysisPrompt = (mode: ResponseMode): string => {
    switch (mode) {
        case ResponseMode.Resumido:
            return "Genera un resumen conciso y breve del siguiente texto, capturando las ideas principales en uno o dos párrafos.";
        case ResponseMode.Completo:
            return "Actúa como un experto en la materia del siguiente texto. Tu tarea es crear un resumen sumamente completo y exhaustivo que sirva como material de estudio. Desarrolla en profundidad todos los conceptos y puntos clave, sin omitir ningún detalle relevante. Incluye insights y análisis adicionales que aporten valor y faciliten la comprensión total del tema. La estructura debe ser clara, lógica y didáctica, utilizando encabezados y párrafos para organizar la información.";
        case ResponseMode.PuntosClave:
            return "Extrae los puntos clave o las ideas más importantes del siguiente texto. Presenta los resultados en una lista con viñetas, donde cada punto sea claro y directo.";
        default:
            return "Analiza el siguiente texto:";
    }
};

export const generateTextAnalysis = async (text: string, mode: ResponseMode): Promise<string> => {
    try {
        const prompt = getAnalysisPrompt(mode);
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `${prompt}\n\n--- INICIO DEL TEXTO ---\n\n${text}\n\n--- FIN DEL TEXTO ---`,
        });
        
        const resultText = response.text;
        // FIX: The type of `response.text` is `string | undefined`.
        // This check ensures we only return a string, satisfying TypeScript's strict mode.
        if (typeof resultText !== 'string') {
            throw new Error(`La respuesta de la API para el modo "${mode}" no contiene texto.`);
        }
        return resultText;

    } catch (error) {
        console.error(`Error during text analysis for mode ${mode}:`, error);
        throw error;
    }
};

export const translateText = async (text: string): Promise<string> => {
    try {
        const prompt = `Traduce el siguiente texto de español a inglés. Mantén el formato y el tono del texto original.\n\n--- INICIO DEL TEXTO ---\n\n${text}\n\n--- FIN DEL TEXTO ---`;
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        
        const resultText = response.text;
        // FIX: The type of `response.text` is `string | undefined`.
        // This check ensures we only return a string, satisfying TypeScript's strict mode.
        if (typeof resultText !== 'string') {
            throw new Error("La respuesta de la API para la traducción no contiene texto.");
        }
        return resultText;

    } catch (error) {
        console.error("Error during translation:", error);
        throw error;
    }
};

const cleanTextForSpeech = (text: string): string => {
    // Remove common markdown formatting that can interfere with TTS.
    return text
        // Remove markdown headers (e.g., #, ##, ###)
        .replace(/^#{1,6}\s+/gm, '')
        // Remove markdown blockquotes (e.g., >)
        .replace(/^>\s?/gm, '')
        // Remove markdown links but keep the link text (e.g., [text](url) -> text)
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
        // Remove horizontal rules (e.g., ---, ***, ___)
        .replace(/^(---|___|\*\*\*)\s*$/gm, '')
        // Remove bullet point markers but keep the text
        .replace(/^(\*|-|\+)\s+/gm, '')
        // Remove bold, italic, strikethrough, code markers
        .replace(/(\*\*|__|\*|_|~~|`)/g, '')
        // Replace multiple newlines with a single space for better flow
        .replace(/\n+/g, ' ')
        // Collapse multiple spaces into one
        .replace(/\s{2,}/g, ' ')
        .trim();
};


export const generateSpeech = async (text: string, language: 'es' | 'en'): Promise<string> => {
    try {
        const cleanedText = cleanTextForSpeech(text);
        if (!cleanedText) {
            throw new Error("Text is empty after cleaning, cannot generate speech.");
        }

        const voiceName = language === 'es' ? 'Kore' : 'Zephyr';

        const instruction = language === 'es'
            ? 'Tu única tarea es leer en voz alta el siguiente texto de forma clara y natural. No añadas introducciones ni comentarios. Solo lee el texto proporcionado. Texto a leer:'
            : 'Your only task is to read the following text aloud clearly and naturally. Do not add any introductions or comments. Just read the provided text. Text to read:';

        const prompt = `${instruction}\n\n"${cleanedText}"`;
       
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: prompt }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceName },
                    },
                },
            },
        });

        if (response.promptFeedback?.blockReason) {
            throw new Error(`Speech generation was blocked due to: ${response.promptFeedback.blockReason}`);
        }

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) {
            console.warn("API returned no audio data for text:", cleanedText);
            throw new Error("No audio data received from API.");
        }
        return base64Audio;
    } catch (error) {
        console.error("Error during speech generation:", error);
        throw error;
    }
};