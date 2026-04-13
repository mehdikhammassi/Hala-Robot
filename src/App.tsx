/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { Mic, MicOff, Volume2, Plane, MapPin, Info, Globe, Loader2, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Constants for audio processing
const SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

const GREETINGS = [
  { 
    text: "Hi", 
    sub: "Welcome to Dubai. I am Hala, and I am at your service.", 
    lang: "English" 
  },
  { 
    text: "مرحبا", 
    sub: "مرحباً بكم في دبي. أنا هلا، وأنا في خدمتكم.", 
    lang: "Arabic" 
  },
  { 
    text: "Bienvenue", 
    sub: "Bienvenue à Dubaï. Je suis Hala, et je suis à votre service.", 
    lang: "French" 
  },
  { 
    text: "Hola", 
    sub: "Bienvenido a Dubái. Soy Hala y estoy a su servicio.", 
    lang: "Spanish" 
  },
  { 
    text: "नमस्ते", 
    sub: "दुबई में आपका स्वागत है। मैं हाला हूँ, और मैं आपकी सेवा में हूँ।", 
    lang: "Hindi" 
  },
  { 
    text: "خوش آمدید", 
    sub: "دبئی میں خوش آمدید۔ میں ہالا ہوں، اور میں آپ کی خدمت میں حاضر ہوں۔", 
    lang: "Urdu" 
  }
];

const TRANSLATIONS: Record<string, any> = {
  en: {
    ambassador: "AI Voice Ambassador",
    connect: "Connect with Hala",
    experience: "Experience the future of travel assistance. Hala is ready to guide you through DXB.",
    secure: "Secure Connection",
    offline: "Offline",
    end: "End Session",
    gates: "Gates",
    info: "Info",
    flights: "Flights",
    initializing: "Initializing",
    speaking: "Hala Speaking",
    listening: "Listening",
    airport: "Dubai International Airport"
  },
  ar: {
    ambassador: "سفير الصوت بالذكاء الاصطناعي",
    connect: "اتصل بهلا",
    experience: "اختبر مستقبل المساعدة في السفر. هلا مستعدة لإرشادك عبر مطار دبي الدولي.",
    secure: "اتصال آمن",
    offline: "غير متصل",
    end: "إنهاء الجلسة",
    gates: "البوابات",
    info: "معلومات",
    flights: "الرحلات",
    initializing: "جاري التهيئة",
    speaking: "هلا تتحدث",
    listening: "جاري الاستماع",
    airport: "مطار دبي الدولي"
  },
  fr: {
    ambassador: "Ambassadeur Vocal IA",
    connect: "Connecter avec Hala",
    experience: "Découvrez le futur de l'assistance voyage. Hala est prête à vous guider à travers DXB.",
    secure: "Connexion Sécurisée",
    offline: "Hors ligne",
    end: "Terminer la session",
    gates: "Portes",
    info: "Info",
    flights: "Vols",
    initializing: "Initialisation",
    speaking: "Hala parle",
    listening: "Écoute",
    airport: "Aéroport International de Dubaï"
  }
};

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [greetingIndex, setGreetingIndex] = useState(0);
  const [uiLang, setUiLang] = useState('en');
  const [showLangMenu, setShowLangMenu] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const connectedRef = useRef(false);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const t = TRANSLATIONS[uiLang] || TRANSLATIONS.en;

  useEffect(() => {
    const interval = setInterval(() => {
      setGreetingIndex((prev) => (prev + 1) % GREETINGS.length);
    }, 2500);

    const handleGesture = () => {
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
    };
    window.addEventListener('click', handleGesture);

    return () => {
      clearInterval(interval);
      window.removeEventListener('click', handleGesture);
    };
  }, []);

  const systemInstruction = `
    ROLE: You are "Hala," the AI Voice Ambassador for Dubai International Airport (DXB).
    TONE: Warm, professional, and helpful.
    CONCISENESS: Keep responses very short (1-2 sentences).
    MULTILINGUALISM: Respond in the user's language.
    GREETING: Start with "Marhaba! I am Hala. How can I help you today?"
    INTERRUPTION: Stop immediately if the user speaks.

    FLIGHT KNOWLEDGE BASE:
    - EK927 (Dubai to Cairo): Gate B12, Terminal 3, Row B (Counters 20-28). Boarding 14:40, Departs 15:25. Walking time: 6 mins. Nearest: SkyBites Café (Gate B10), Emirates Business Lounge (Gate B14), Restroom (Gate B11).
    - EK017 (Dubai to Manchester): Gate C7, Terminal 3, Row C (Counters 40-48). Boarding 08:10, Departs 08:55. Walking time: 8 mins. Nearest: Global Kitchen (Gate C5), Marhaba Lounge (Gate C9), Restroom (Gate C6).
    - EK071 (Dubai to Paris): Gate A4, Terminal 3, Row A (Counters 10-18). Boarding 22:20, Departs 23:00. Walking time: 5 mins. Nearest: Le Petit Café (Gate A2), Emirates First Class Lounge (Gate A5), Restroom (Gate A3).
    - EK510 (Dubai to Delhi): Gate D9, Terminal 3, Row D (Counters 55-62). Boarding 18:00, Departs 18:45. Walking time: 7 mins. Nearest: Spice Route (Gate D7), Plaza Premium Lounge (Gate D11), Restroom (Gate D8).
    - EK600 (Dubai to Karachi): Gate E3, Terminal 3, Row E (Counters 70-78). Boarding 11:35, Departs 12:15. Walking time: 6 mins. Nearest: Desert Grill (Gate E1), Marhaba Lounge (Gate E5), Restroom (Gate E2).
  `;

  // Helper: Convert Float32Array to Base64 PCM
  const float32ToPcmBase64 = (buffer: Float32Array) => {
    const pcm = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      pcm[i] = Math.max(-1, Math.min(1, buffer[i])) * 0x7FFF;
    }
    const uint8 = new Uint8Array(pcm.buffer);
    // More efficient conversion for larger buffers
    let binary = '';
    const chunk_size = 8192;
    for (let i = 0; i < uint8.length; i += chunk_size) {
      binary += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + chunk_size)));
    }
    return btoa(binary);
  };

  // Helper: Convert Base64 PCM to Float32Array
  const pcmBase64ToFloat32 = (base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const pcm = new Int16Array(bytes.buffer.slice(0, bytes.length - (bytes.length % 2)));
    const float32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      float32[i] = pcm[i] / 0x7FFF;
    }
    return float32;
  };

  const playNextInQueue = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx || audioQueueRef.current.length === 0) return;
    
    if (ctx.state === 'suspended') ctx.resume();

    while (audioQueueRef.current.length > 0) {
      const buffer = audioQueueRef.current.shift()!;
      const audioBuffer = ctx.createBuffer(1, buffer.length, OUTPUT_SAMPLE_RATE);
      audioBuffer.getChannelData(0).set(buffer);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const currentTime = ctx.currentTime;
      if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime + 0.05;
      }

      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;
      
      activeSourcesRef.current.push(source);
      setIsSpeaking(true);

      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
        if (activeSourcesRef.current.length === 0 && audioQueueRef.current.length === 0) {
          setIsSpeaking(false);
        }
      };
    }
  }, []);

  const stopAudioPlayback = () => {
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    activeSourcesRef.current = [];
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
    setIsSpeaking(false);
  };

  const connectToHala = async () => {
    try {
      setIsConnecting(true);
      setError(null);
      setTranscript('');

      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass({ sampleRate: SAMPLE_RATE });
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          systemInstruction,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
        },
        callbacks: {
          onopen: async () => {
            console.log("Hala: Connection established");
            setIsConnected(true);
            connectedRef.current = true;
            setIsConnecting(false);
            
            // Resolve the session and store it
            const session = await sessionPromise;
            sessionRef.current = session;
            
            await startMic();
            
            // Trigger initial greeting with a small delay to ensure audio is ready
            setTimeout(() => {
              if (sessionRef.current) {
                sessionRef.current.sendRealtimeInput({ text: "Marhaba Hala! I am a traveler at DXB. Please greet me and ask how you can help." });
              }
            }, 500);
          },
          onmessage: (message) => {
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  const audioData = pcmBase64ToFloat32(part.inlineData.data);
                  audioQueueRef.current.push(audioData);
                  playNextInQueue();
                }
                if (part.text) {
                  setTranscript(prev => prev + " " + part.text);
                }
              }
            }
            
            if (message.serverContent?.interrupted) {
              stopAudioPlayback();
            }
          },
          onclose: () => {
            console.log("Hala: Connection closed");
            setIsConnected(false);
            connectedRef.current = false;
            stopMic();
          },
          onerror: (err: any) => {
            console.error("Hala: Live API Error:", err);
            setError(`Connection error: ${err.message || 'Please check your internet connection.'}`);
            setIsConnected(false);
            connectedRef.current = false;
            setIsConnecting(false);
          }
        }
      });

    } catch (err: any) {
      console.error("Hala: Failed to connect:", err);
      setError(`Could not establish connection: ${err.message || 'Unknown error'}`);
      setIsConnecting(false);
    }
  };

  const startMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass({ sampleRate: SAMPLE_RATE });
      }
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (e) => {
        if (sessionRef.current && connectedRef.current) {
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Calculate volume for visual feedback
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sum / inputData.length);
          setVolume(rms);

          const base64Data = float32ToPcmBase64(inputData);
          sessionRef.current.sendRealtimeInput({
            media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          });
        }
      };

      source.connect(processor);
      
      // Connect to a silent gain node to keep the processor active without feedback
      const silentGain = audioContextRef.current.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioContextRef.current.destination);
      
      processorRef.current = processor;
      setIsListening(true);
    } catch (err) {
      console.error("Mic error:", err);
      setError("Microphone access denied.");
    }
  };

  const stopMic = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    setIsListening(false);
  };

  const disconnect = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    connectedRef.current = false;
    stopMic();
    stopAudioPlayback();
    setIsConnected(false);
  };

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center p-6 bg-[#050505] overflow-hidden ${uiLang === 'ar' ? 'font-sans' : ''}`} dir={uiLang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Background Atmosphere */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-dxb-gold/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-dxb-blue/20 rounded-full blur-[100px]" />
      </div>

      {/* Language Selector */}
      <div className="absolute top-6 right-6 z-50">
        <button 
          onClick={() => setShowLangMenu(!showLangMenu)}
          className="glass-panel px-4 py-2 rounded-full flex items-center gap-2 text-xs uppercase tracking-widest text-white/70 hover:text-white transition-colors"
        >
          <Globe className="w-3 h-3" />
          {uiLang.toUpperCase()}
          <ChevronDown className={`w-3 h-3 transition-transform ${showLangMenu ? 'rotate-180' : ''}`} />
        </button>
        <AnimatePresence>
          {showLangMenu && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute top-full right-0 mt-2 glass-panel rounded-2xl p-2 min-w-[120px] shadow-2xl"
            >
              {Object.keys(TRANSLATIONS).map((lang) => (
                <button
                  key={lang}
                  onClick={() => {
                    setUiLang(lang);
                    setShowLangMenu(false);
                  }}
                  className={`w-full text-left px-4 py-2 rounded-xl text-xs uppercase tracking-widest hover:bg-white/10 transition-colors ${uiLang === lang ? 'text-dxb-gold' : 'text-white/60'}`}
                >
                  {lang === 'en' ? 'English' : lang === 'ar' ? 'العربية' : 'Français'}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="z-10 text-center mb-12"
      >
        <div className="flex items-center justify-center gap-3 mb-2">
          <Plane className="text-dxb-gold w-6 h-6" />
          <h1 className="font-display text-2xl font-bold tracking-widest uppercase text-dxb-gold">
            {t.airport}
          </h1>
        </div>
        <div className="h-6 flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.p 
              key={greetingIndex}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-white/50 text-sm tracking-wide"
            >
              {GREETINGS[greetingIndex].sub}
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Main Interface */}
      <div className="relative z-10 w-full max-w-md">
        <AnimatePresence mode="wait">
          {!isConnected && !isConnecting ? (
            <motion.div
              key="start"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="glass-panel rounded-[40px] p-12 text-center flex flex-col items-center"
            >
              <div className="w-24 h-24 bg-dxb-gold/10 rounded-full flex items-center justify-center mb-8 relative">
                <div className="absolute inset-0 rounded-full border border-dxb-gold/30 pulse-ring" />
                <Globe className="text-dxb-gold w-10 h-10" />
              </div>
              
              <div className="h-12 flex items-center justify-center mb-4">
                <AnimatePresence mode="wait">
                  <motion.h2 
                    key={greetingIndex}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="font-display text-3xl font-light"
                  >
                    {GREETINGS[greetingIndex].text}
                  </motion.h2>
                </AnimatePresence>
              </div>

              <p className="text-white/60 mb-10 leading-relaxed">
                {t.experience}
              </p>
              <button
                onClick={connectToHala}
                className="w-full py-4 bg-dxb-gold text-black font-bold rounded-2xl glow-gold hover:bg-white transition-all duration-300 uppercase tracking-widest text-sm"
              >
                {t.connect}
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="active"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center"
            >
              {/* Hala's Visualizer */}
              <div className="relative w-64 h-64 flex items-center justify-center mb-12">
                <motion.div 
                  animate={{ 
                    scale: isSpeaking ? [1, 1.1, 1] : 1,
                    opacity: isSpeaking ? [0.3, 0.6, 0.3] : 0.2
                  }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="absolute inset-0 rounded-full border border-dxb-gold/30"
                />
                <motion.div 
                  animate={{ 
                    scale: isListening ? [1, 1.05, 1] : 1,
                    opacity: isListening ? [0.2, 0.4, 0.2] : 0.1
                  }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="absolute inset-[-20px] rounded-full border border-white/10"
                />

                <div className="w-40 h-40 rounded-full glass-panel flex flex-col items-center justify-center relative overflow-hidden">
                  {isConnecting ? (
                    <Loader2 className="w-12 h-12 text-dxb-gold animate-spin" />
                  ) : (
                    <>
                      <AnimatePresence mode="wait">
                        {isSpeaking ? (
                          <motion.div
                            key="speaking"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                          >
                            <Volume2 className="w-12 h-12 text-dxb-gold" />
                          </motion.div>
                        ) : (
                          <motion.div
                            key="listening"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                          >
                            <Mic className={`w-12 h-12 ${isListening ? 'text-dxb-gold' : 'text-white/20'}`} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <div className="mt-4 text-[10px] uppercase tracking-[0.2em] text-white/40">
                        {isConnecting ? t.initializing : isSpeaking ? t.speaking : t.listening}
                      </div>
                      {isListening && !isSpeaking && (
                        <div className="mt-2 w-12 h-1 bg-white/10 rounded-full overflow-hidden">
                          <motion.div 
                            animate={{ width: `${Math.min(100, volume * 500)}%` }}
                            className="h-full bg-dxb-gold"
                          />
                        </div>
                      )}
                    </>
                  )}
                  
                  {(isSpeaking || isListening) && !isConnecting && (
                    <div className="absolute bottom-0 left-0 right-0 h-12 flex items-end justify-center gap-1 px-4 pb-4">
                      {[...Array(8)].map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{ 
                            height: (isSpeaking || isListening) ? [8, Math.random() * 24 + 8, 8] : 4 
                          }}
                          transition={{ repeat: Infinity, duration: 0.5 + Math.random() * 0.5 }}
                          className="w-1 bg-dxb-gold/40 rounded-full"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Status & Controls */}
              <div className="w-full glass-panel rounded-3xl p-6 flex flex-col gap-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500'}`} />
                    <span className="text-xs uppercase tracking-widest text-white/60">
                      {isConnected ? t.secure : t.offline}
                    </span>
                  </div>
                  <button 
                    onClick={disconnect}
                    className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white transition-colors"
                  >
                    {t.end}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white/5">
                    <MapPin className="w-4 h-4 text-dxb-gold/60" />
                    <span className="text-[9px] uppercase tracking-tighter text-white/40">{t.gates}</span>
                  </div>
                  <div className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white/5">
                    <Info className="w-4 h-4 text-dxb-gold/60" />
                    <span className="text-[9px] uppercase tracking-tighter text-white/40">{t.info}</span>
                  </div>
                  <div className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white/5">
                    <Plane className="w-4 h-4 text-dxb-gold/60" />
                    <span className="text-[9px] uppercase tracking-tighter text-white/40">{t.flights}</span>
                  </div>
                </div>

                {transcript && (
                  <div className="mt-2 p-4 rounded-2xl bg-white/5 max-h-24 overflow-y-auto text-xs text-white/60 leading-relaxed scrollbar-hide">
                    {transcript}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-red-500/20 border border-red-500/50 backdrop-blur-md px-6 py-3 rounded-full text-sm text-red-200 z-50"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <div className="mt-12 text-white/20 text-[10px] uppercase tracking-[0.4em]">
        Dubai Airports &copy; 2026
      </div>
    </div>
  );
}
