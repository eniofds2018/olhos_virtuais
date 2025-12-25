
import { GoogleGenAI, Modality } from "@google/genai";
import { decodeBase64, decodeAudioData } from "../utils/audio-utils";

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

export interface GeminiCallbacks {
  onAudioOutput: (buffer: AudioBuffer) => void;
  onInterrupted: () => void;
  onTranscription?: (text: string, isUser: boolean) => void;
  onError: (error: any) => void;
  onClose: () => void;
}

export async function connectGeminiLive(callbacks: GeminiCallbacks, outputAudioContext: AudioContext) {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const systemInstruction = `
    Você é um assistente de locomoção para crianças e adolescentes com deficiência visual chamado GuiaVision.
    Seu objetivo é descrever o ambiente de forma clara, amigável e concisa.
    1. Identifique obstáculos, pessoas e objetos à frente.
    2. Estime a distância em metros (ex: "Obstáculo a 2 metros").
    3. Diga se algo está "muito próximo" (menos de 1 metro) ou "seguro".
    4. Reconheça e leia em voz alta qualquer texto, placa, símbolo ou número que aparecer.
    5. Seja proativo: se vir um perigo iminente, use um tom de alerta.
    6. Mantenha as descrições curtas para não sobrecarregar o usuário.
    7. Use linguagem simples e adequada para o público jovem.
  `;

  const sessionPromise = ai.live.connect({
    model: MODEL_NAME,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
      },
      outputAudioTranscription: {},
      inputAudioTranscription: {},
    },
    callbacks: {
      onopen: () => console.log("Gemini Session Opened"),
      onmessage: async (message) => {
        // Handle Audio
        const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (audioData) {
          const buffer = await decodeAudioData(
            decodeBase64(audioData),
            outputAudioContext,
            24000,
            1
          );
          callbacks.onAudioOutput(buffer);
        }

        // Handle Interruption
        if (message.serverContent?.interrupted) {
          callbacks.onInterrupted();
        }

        // Handle Transcriptions
        if (message.serverContent?.outputTranscription) {
          callbacks.onTranscription?.(message.serverContent.outputTranscription.text, false);
        }
        if (message.serverContent?.inputTranscription) {
          callbacks.onTranscription?.(message.serverContent.inputTranscription.text, true);
        }
      },
      onerror: (e) => callbacks.onError(e),
      onclose: () => callbacks.onClose(),
    }
  });

  return sessionPromise;
}
