
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AppState, RecognitionAlert } from './types';
import { connectGeminiLive } from './services/geminiLiveService';
import { createPcmBlob } from './utils/audio-utils';

const FRAME_RATE = 1; // 1 frame per second to avoid over-requesting
const JPEG_QUALITY = 0.6;

const App: React.FC = () => {
  const [status, setStatus] = useState<AppState>(AppState.IDLE);
  const [alerts, setAlerts] = useState<RecognitionAlert[]>([]);
  const [lastTranscript, setLastTranscript] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const frameIntervalRef = useRef<number | null>(null);

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    window.speechSynthesis.speak(utterance);
  };

  const stopAudio = useCallback(() => {
    activeSourcesRef.current.forEach(source => source.stop());
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const startAssistance = async () => {
    try {
      setStatus(AppState.CONNECTING);
      speak("Iniciando GuiaVision. Por favor, aguarde.");

      // Init Audio Contexts
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });

      // Get Media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: true
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Connect Gemini
      const sessionPromise = connectGeminiLive({
        onAudioOutput: (buffer) => {
          if (!audioContextRef.current) return;
          const ctx = audioContextRef.current;
          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.onended = () => activeSourcesRef.current.delete(source);
          source.start(nextStartTimeRef.current);
          nextStartTimeRef.current += buffer.duration;
          activeSourcesRef.current.add(source);
        },
        onInterrupted: () => stopAudio(),
        onTranscription: (text, isUser) => {
          if (!isUser) setLastTranscript(text);
        },
        onError: (err) => {
          console.error(err);
          setStatus(AppState.ERROR);
          speak("Ocorreu um erro na conexão.");
        },
        onClose: () => {
          setStatus(AppState.IDLE);
          speak("Assistente desligado.");
        }
      }, audioContextRef.current);

      sessionRef.current = await sessionPromise;
      setStatus(AppState.ACTIVE);
      speak("Assistente ativo. Estou observando o caminho para você.");

      // Start Video Streaming
      frameIntervalRef.current = window.setInterval(() => {
        if (!videoRef.current || !canvasRef.current || !sessionRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
          if (blob) {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(',')[1];
              sessionRef.current.sendRealtimeInput({
                media: { data: base64, mimeType: 'image/jpeg' }
              });
            };
            reader.readAsDataURL(blob);
          }
        }, 'image/jpeg', JPEG_QUALITY);
      }, 1000 / FRAME_RATE);

      // Start Audio Streaming
      const audioSource = inputAudioContextRef.current.createMediaStreamSource(stream);
      const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
      scriptProcessor.onaudioprocess = (e) => {
        if (status === AppState.ACTIVE && sessionRef.current) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcm = createPcmBlob(inputData);
          sessionRef.current.sendRealtimeInput({ media: pcm });
        }
      };
      audioSource.connect(scriptProcessor);
      scriptProcessor.connect(inputAudioContextRef.current.destination);

    } catch (error) {
      console.error(error);
      setStatus(AppState.ERROR);
      speak("Não consegui acessar a câmera ou o microfone.");
    }
  };

  const stopAssistance = () => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (sessionRef.current) sessionRef.current.close();
    stopAudio();
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
    }
    setStatus(AppState.IDLE);
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white font-sans overflow-hidden select-none">
      {/* Visual Feedback for Sighted Helpers */}
      <div className="relative h-2/5 w-full bg-neutral-900 overflow-hidden">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className="w-full h-full object-cover opacity-50"
        />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-0 flex items-center justify-center">
            {status === AppState.IDLE && (
                <div className="text-center p-4">
                    <div className="w-16 h-16 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-4 hidden" />
                    <p className="text-2xl font-bold text-yellow-400">GuiaVision Pronto</p>
                </div>
            )}
            {status === AppState.ACTIVE && (
                <div className="w-full h-full border-8 border-green-500 animate-pulse pointer-events-none" />
            )}
            {status === AppState.CONNECTING && (
                 <p className="text-2xl font-bold text-blue-400 animate-pulse">Conectando...</p>
            )}
        </div>
      </div>

      {/* Main Interaction Area */}
      <main className="flex-1 flex flex-col p-6 space-y-6">
        <div className="flex-1 overflow-y-auto bg-neutral-800 rounded-3xl p-6 border-4 border-neutral-700">
           <h2 className="text-sm uppercase tracking-widest text-neutral-400 font-bold mb-2">Status da IA</h2>
           <p className="text-2xl md:text-3xl font-medium leading-tight">
             {status === AppState.IDLE && "Toque no botão abaixo para começar a usar seu assistente."}
             {status === AppState.CONNECTING && "Estamos preparando tudo para sua segurança..."}
             {status === AppState.ACTIVE && (lastTranscript || "Estou observando... Mantenha o celular firme à frente.")}
             {status === AppState.ERROR && "Ops! Algo deu errado. Verifique sua conexão e tente novamente."}
           </p>
        </div>

        {/* Huge Interactive Buttons for accessibility */}
        <div className="h-48 flex gap-4">
          {status !== AppState.ACTIVE ? (
            <button
              onClick={startAssistance}
              className="flex-1 bg-yellow-400 text-black rounded-3xl flex flex-col items-center justify-center shadow-lg active:scale-95 transition-transform"
              aria-label="Iniciar assistente de voz e visão"
            >
              <span className="text-5xl mb-2">🚀</span>
              <span className="text-2xl font-black uppercase">Começar</span>
            </button>
          ) : (
            <button
              onClick={stopAssistance}
              className="flex-1 bg-red-600 text-white rounded-3xl flex flex-col items-center justify-center shadow-lg active:scale-95 transition-transform"
              aria-label="Parar assistente"
            >
              <span className="text-5xl mb-2">🛑</span>
              <span className="text-2xl font-black uppercase">Parar</span>
            </button>
          )}

          <button
            onClick={() => speak("GuiaVision está ativo e utiliza inteligência artificial para descrever obstáculos, ler textos e estimar distâncias para ajudar na sua locomoção.")}
            className="w-1/3 bg-blue-600 text-white rounded-3xl flex flex-col items-center justify-center shadow-lg active:scale-95 transition-transform"
            aria-label="Ouvir ajuda sobre o aplicativo"
          >
            <span className="text-4xl mb-2">❓</span>
            <span className="text-lg font-bold uppercase">Ajuda</span>
          </button>
        </div>
      </main>

      {/* Accessible Footer Hint */}
      <footer className="bg-neutral-900 p-4 text-center text-xs text-neutral-500 uppercase font-bold">
        GuiaVision AI • Assistência em Tempo Real
      </footer>
    </div>
  );
};

export default App;
