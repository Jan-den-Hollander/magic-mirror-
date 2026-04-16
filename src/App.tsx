/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GuidaSection } from './GuidaInstructions';
import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { Mic, MicOff, Volume2, Sparkles, Camera, CameraOff, ChevronRight, RotateCcw, Settings, MessageSquare, Trophy, Save, Key } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// ✅ 'error' toegevoegd aan role — voor de foutbubbel in het gespreksveld
interface Message {
  role: 'user' | 'model' | 'error';
  en: string;
  it: string;
  score?: number;
  heard?: string;
}

const SYSTEM_PROMPT = `You are Victoria, a refined Oxford lady speaking impeccable Queen's English. You help Italian speakers practise British English through mirror conversation and shadowing.
RULES: ONE short British English sentence per turn (max 12 words). Always end with a question. Always use British spelling (colour, behaviour, organise, whilst, amongst, favour). Use expressions like "Quite", "Indeed", "Splendid", "Rather", "I daresay". Gently correct errors with ✏️ You might say: [correction] on a new line inside "en".
RESPOND ONLY with valid JSON, no explanation or Markdown: {"en":"English sentence","it":"Italian translation"}`;

export default function App() {
  const [isCamOn, setIsCamOn] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [level, setLevel] = useState('B1');
  const [topic, setTopic] = useState('daily life');
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState('Pronto · Ready');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [customKey, setCustomKey] = useState(localStorage.getItem('specchio_english_api_key') || '');
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const showFlags = windowWidth >= 480;

  const getAI = () => new GoogleGenAI({ apiKey: customKey || process.env.GEMINI_API_KEY || "" });

  const saveCustomKey = (key: string) => {
    localStorage.setItem('specchio_english_api_key', key);
    setCustomKey(key);
    setShowKeyModal(false);
    setStatus('API Key saved! · Salvato!');
  };

  const prevMessagesLength = useRef(0);
  useEffect(() => {
    if (messages.length > prevMessagesLength.current || isThinking) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessagesLength.current = messages.length;
  }, [messages.length, isThinking]);

  // ✅ Safari-fix: AudioContext initialiseren of hervatten tijdens een klik
  const ensureAudioContext = () => {
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    } else if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  };

  const toggleCam = async () => {
    if (isCamOn) {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setIsCamOn(false);
      setStatus('Mirror off · Specchio spento');
    } else {
      try {
        setStatus('Starting camera...');
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("No camera support");
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setTimeout(() => videoRef.current?.play().catch(console.error), 100);
        }
        streamRef.current = stream;
        setIsCamOn(true);
        setStatus('Mirror active! ✨ · Specchio attivo!');
      } catch {
        setStatus('Camera access denied · Accesso negato');
        setIsCamOn(false);
      }
    }
  };

  const speakIt = async (text: string) => {
    if (!text) return;
    setIsSpeaking(true);
    setStatus('The mirror speaks... · Lo specchio parla...');
    try {
      const aiInstance = getAI();
      const response = await aiInstance.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Puck" }
            }
          }
        },
      });
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        const int16Data = new Int16Array(bytes.buffer);
        const float32Data = new Float32Array(int16Data.length);
        for (let i = 0; i < int16Data.length; i++) float32Data[i] = int16Data[i] / 32768.0;
        const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
        audioBuffer.getChannelData(0).set(float32Data);
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        source.onended = () => { setIsSpeaking(false); setStatus('Press 🎤 to reply · Premi 🎤 per rispondere'); };
        source.start();
      } else throw new Error("No audio");
    } catch {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-GB'; utterance.rate = 0.85;
      utterance.onend = () => { setIsSpeaking(false); setStatus('Press 🎤 to reply · Premi 🎤 per rispondere'); };
      window.speechSynthesis.speak(utterance);
      setStatus('Browser voice used (fallback)');
    }
  };

  // ✅ Safari-fix: ensureAudioContext bij de microfoonklik
  const startRecording = () => {
    ensureAudioContext();
    try {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) { setStatus('Speech recognition not supported'); return; }
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(_) {} }
      recognitionRef.current = new SR();
      recognitionRef.current.lang = 'en-GB';
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.onstart = () => { setIsRecording(true); setStatus('Listening... · Ascolto...'); };
      recognitionRef.current.onresult = (e: any) => { setIsRecording(false); processHeard(e.results[0][0].transcript); };
      recognitionRef.current.onerror = () => { setIsRecording(false); setStatus('Microphone error.'); };
      recognitionRef.current.onend = () => setIsRecording(false);
      recognitionRef.current.start();
    } catch { setStatus('Could not start microphone.'); setIsRecording(false); }
  };

  const stopRecording = () => { recognitionRef.current?.stop(); setIsRecording(false); };

  const processHeard = async (heard: string) => {
    if (!heard.trim()) return;
    const lastModelMsg = messages.filter(m => m.role === 'model').pop();
    let currentScore = 0;
    if (lastModelMsg) {
      const sim = calculateSimilarity(lastModelMsg.en, heard);
      if (sim > 0.7) currentScore = 2; else if (sim > 0.4) currentScore = 1;
      setScore(prev => prev + currentScore);
    }
    const userMsg: Message = { role: 'user', en: heard, it: '', heard, score: currentScore };
    setMessages(prev => [...prev, userMsg]);
    generateAIResponse([...messages, userMsg]);
  };

  const calculateSimilarity = (s1: string, s2: string) => {
    const a = s1.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
    const b = s2.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.8;
    return 0.5;
  };

  // ✅ Nieuwe generateAIResponse met timeout + automatische retry + foutbubbel
  const generateAIResponse = async (history: Message[], retryCount = 0) => {
    setIsThinking(true);
    setStatus(retryCount > 0
      ? 'Trying again... · Ritento...'
      : 'The mirror thinks... · Lo specchio pensa...'
    );

    const systemPrompt = `${SYSTEM_PROMPT}\nLevel: ${level}. Current Topic: ${topic}.`;

    // Foutberichten niet meesturen naar de AI
    const contents = history
      .filter(m => m.role !== 'error')
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.role === 'user'
          ? m.en
          : JSON.stringify({ en: m.en, it: m.it }) }]
      }));

    try {
      const aiInstance = getAI();

      // Tijdslimiet: 12 seconden. Daarna automatisch retry op sneller model.
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 12000)
      );

      const responsePromise = aiInstance.models.generateContent({
        // Eerste poging: gemini-2.5-flash. Retry: gemini-2.0-flash (sneller)
        model: retryCount > 0 ? "gemini-2.0-flash" : "gemini-2.5-flash",
        contents: contents.length > 0
          ? contents
          : [{ role: 'user', parts: [{ text: 'Start the conversation with a warm Oxford greeting and one opening question.' }] }],
        config: { systemInstruction: systemPrompt, responseMimeType: "application/json" },
      });

      const response = await Promise.race([responsePromise, timeoutPromise]);
      const data = JSON.parse(response.text || "{}");
      const aiMsg: Message = {
        role: 'model',
        en: data.en || "How delightful! Shall we continue?",
        it: data.it || "",
      };
      setMessages(prev => [...prev, aiMsg]);
      setIsThinking(false);
      speakIt(aiMsg.en);

    } catch {
      // Eerste mislukking → stil automatisch herproberenop sneller model
      if (retryCount === 0) {
        setStatus('Connection slow, trying again...');
        setTimeout(() => generateAIResponse(history, 1), 2000);
        return;
      }

      // Tweede mislukking → toon tweetalige foutbubbel (EN + IT) in gespreksveld
      setIsThinking(false);
      setStatus('Server busy · Server sovraccarico');
      const errorMsg: Message = { role: 'error', en: '', it: '' };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  // ✅ Safari-fix: ensureAudioContext ook bij New Conversation
  const startNewConversation = () => {
    ensureAudioContext();
    setMessages([]);
    setScore(0);
    generateAIResponse([]);
  };

  const downloadTranscript = () => {
    if (!messages.length) return;
    const text = messages
      .filter(m => m.role !== 'error')
      .map(m => `[${m.role === 'user' ? 'YOU' : 'VICTORIA'}]\nEN: ${m.en}\nIT: ${m.it || '-'}\n`)
      .join('\n---\n\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'conversation-english.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen w-full bg-[#080810] text-[#f5f0e8] font-sans selection:bg-[#4a7ab5]/30 flex flex-col pb-8">
      <div className="flex flex-col max-w-md mx-auto w-full px-4 pt-4 relative z-10">

        <header className="text-center pb-4">
          <motion.h1 initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
            className="font-serif text-3xl font-light tracking-widest text-[#7ab4e8] drop-shadow-[0_0_20px_rgba(74,122,181,0.4)]">
            Specchio English
          </motion.h1>
          <a href="#guida"
            className="text-[0.55rem] tracking-[0.15em] uppercase opacity-40 hover:opacity-80 transition-opacity mt-1 block"
            style={{ color: 'inherit' }}>
            Come iniziare · Hoe te beginnen · How to start ↓
          </a>
          <p className="text-[0.6rem] tracking-[0.2em] uppercase text-[#4a7ab5]/50 mt-1">
            Victoria · Lady of Oxford · Queen's English
          </p>
        </header>

        {/* Mirror + Flanking Flags */}
        <div className="relative flex items-center justify-center mb-5">

          {showFlags && (
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
              className="flex flex-col items-center gap-1 mr-5 select-none">
              <span className="text-4xl drop-shadow-lg">🇮🇹</span>
              <span className="text-[0.5rem] tracking-widest uppercase text-[#4a7ab5]/40">Italiano</span>
            </motion.div>
          )}

          <div className="relative w-full max-w-[200px] aspect-[3/4]">
            <div className="absolute inset-0 bg-gradient-to-br from-[#1a3a6a] via-[#4a7ab5] to-[#0d2340] rounded-[50%_50%_46%_46%_/_28%_28%_72%_72%] p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.8)]">
              <div className="w-full h-full bg-[#080818] rounded-[47%_47%_44%_44%_/_26%_26%_74%_74%] overflow-hidden relative">
                <video ref={videoRef} autoPlay playsInline muted
                  className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-1000 ${isCamOn ? 'opacity-100' : 'opacity-0'}`} />
                <AnimatePresence>
                  {!isCamOn && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                      <Sparkles className="w-8 h-8 text-[#4a7ab5] mb-2 animate-pulse" />
                      <small className="text-[#4a7ab5]/60 text-[0.6rem] uppercase tracking-wider leading-relaxed">Mirror off<br/>Specchio spento</small>
                    </motion.div>
                  )}
                </AnimatePresence>
                {isSpeaking && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1">
                    {[0, 0.15, 0.3].map((d, i) => (
                      <div key={i} className="w-1 h-3 bg-[#7ab4e8]/80 rounded-full animate-bounce" style={{ animationDelay: `${d}s` }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button type="button" onClick={(e) => { e.preventDefault(); toggleCam(); }}
              className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-[#080810] border border-[#4a7ab5]/30 px-3 py-1.5 rounded-full text-[0.55rem] tracking-widest uppercase text-[#7ab4e8]/80 flex flex-col items-center gap-0.5 z-20 w-[130px] text-center">
              <div className="flex items-center gap-1.5">
                {isCamOn ? <CameraOff size={10} /> : <Camera size={10} />}
                <span>{isCamOn ? 'Stop Mirror' : 'Start Mirror'}</span>
              </div>
              <span className="text-[0.45rem] opacity-60">{isCamOn ? 'Spegni specchio' : 'Accendi specchio'}</span>
            </button>
          </div>

          {showFlags && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
              className="flex flex-col items-center gap-1 ml-5 select-none">
              <span className="text-4xl drop-shadow-lg">🇬🇧</span>
              <span className="text-[0.5rem] tracking-widest uppercase text-[#4a7ab5]/40">English</span>
            </motion.div>
          )}
        </div>

        {/* Settings */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="space-y-1">
            <label className="text-[0.55rem] uppercase tracking-widest text-[#4a7ab5]/50 ml-1 flex items-center gap-1"><Settings size={8} /> Level · Livello</label>
            <select value={level} onChange={(e) => setLevel(e.target.value)}
              className="w-full bg-[#4a7ab5]/5 border border-[#4a7ab5]/20 rounded-lg px-2 py-2 text-[0.7rem] outline-none text-[#7ab4e8]">
              <option value="A1">A1 - Beginner</option>
              <option value="A2">A2 - Elementary</option>
              <option value="B1">B1 - Intermediate</option>
              <option value="B2">B2 - Upper-intermediate</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[0.55rem] uppercase tracking-widest text-[#4a7ab5]/50 ml-1 flex items-center gap-1"><MessageSquare size={8} /> Topic · Argomento</label>
            <select value={topic} onChange={(e) => setTopic(e.target.value)}
              className="w-full bg-[#4a7ab5]/5 border border-[#4a7ab5]/20 rounded-lg px-2 py-2 text-[0.7rem] outline-none text-[#7ab4e8]">
              <option value="daily life">Daily Life</option>
              <option value="restaurant">Restaurant</option>
              <option value="travel">Travel</option>
              <option value="family">Family</option>
              <option value="work">Work</option>
              <option value="weather">British Weather</option>
              <option value="culture">British Culture</option>
            </select>
          </div>
        </div>

        {/* Action Row */}
        <div className="flex items-center justify-center gap-6 mb-2">
          <div className="flex flex-col items-center gap-1">
            <button type="button" onClick={() => messages.length > 0 && speakIt(messages[messages.length-1].en)}
              className="w-10 h-10 rounded-full bg-[#4a7ab5]/10 border border-[#4a7ab5]/20 flex items-center justify-center text-[#7ab4e8]">
              <Volume2 size={16} />
            </button>
            <span className="text-[0.5rem] uppercase tracking-widest text-[#4a7ab5]/60 text-center leading-tight">Replay<br/><span className="text-[#4a7ab5]/40">Ripeti</span></span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <button type="button" onClick={isRecording ? stopRecording : startRecording}
              className={`w-16 h-16 rounded-full flex items-center justify-center shadow-xl ${isRecording ? 'bg-red-500/20 border-2 border-red-500 animate-pulse' : 'bg-gradient-to-br from-[#4a7ab5] to-[#1a3a6a]'}`}>
              {isRecording ? <MicOff size={24} className="text-red-500" /> : <Mic size={24} className="text-white" />}
            </button>
            <span className={`text-[0.55rem] uppercase tracking-widest font-bold text-center leading-tight ${isRecording ? 'text-red-500' : 'text-[#7ab4e8]'}`}>
              {isRecording ? <>Listening...<br/><span className="opacity-60">Ascolto</span></> : <>Reply<br/><span className="opacity-60">Rispondi</span></>}
            </span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <button type="button" onClick={() => generateAIResponse(messages)}
              className="w-10 h-10 rounded-full bg-[#4a7ab5]/10 border border-[#4a7ab5]/20 flex items-center justify-center text-[#7ab4e8]">
              <ChevronRight size={16} />
            </button>
            <span className="text-[0.5rem] uppercase tracking-widest text-[#4a7ab5]/60 text-center leading-tight">Skip<br/><span className="text-[#4a7ab5]/40">Salta</span></span>
          </div>
        </div>

        <div className="text-center mb-3">
          <p className="text-[0.65rem] text-[#7ab4e8]/60 min-h-[1em] italic font-medium">{status}</p>
        </div>

        {/* Chat */}
        <div className="w-full h-[35vh] min-h-[250px] bg-black/30 border border-[#4a7ab5]/10 rounded-xl overflow-y-auto p-3 space-y-3 scrollbar-thin mb-4">

          {messages.map((msg, i) => {

            // ✅ Tweetalige foutbubbel (Engels + Italiaans)
            if (msg.role === 'error') {
              return (
                <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-start">
                  <div className="w-full px-3 py-3 rounded-xl rounded-bl-none text-[0.72rem] leading-relaxed bg-amber-900/20 border border-amber-500/30 space-y-2">

                    {/* Hoofdmelding EN */}
                    <p className="text-amber-300 font-semibold text-[0.75rem]">
                      ⚠️ The mirror is temporarily out of reach
                    </p>

                    {/* Uitleg rustige uren EN */}
                    <p className="text-amber-200/70">
                      🕐 The free server is busiest during European daytime and late at night
                      (American gamers). Quietest times to practise: early morning or between
                      13:00 and 15:00 Central European Time.
                    </p>

                    {/* Oefentip EN */}
                    <p className="text-amber-200/70">
                      🎤 Not to worry! Click the microphone to read a sentence aloud,
                      and the loudspeaker 🔊 to hear it back.
                      You can still practise whilst you wait.
                    </p>

                    {/* Italiaanse versie */}
                    <p className="text-amber-200/50 text-[0.65rem] italic">
                      🇮🇹 Nessun problema! Clicca sul microfono per leggere una frase
                      ad alta voce e sull'altoparlante per riascoltarla.
                      Puoi esercitarti lo stesso!
                    </p>

                    {/* Opnieuw proberen */}
                    <button
                      type="button"
                      onClick={() => {
                        setMessages(prev => prev.filter((_, idx) => idx !== i));
                        generateAIResponse(messages.filter(m => m.role !== 'error'));
                      }}
                      className="mt-1 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[0.6rem] uppercase tracking-widest hover:bg-amber-500/30 transition-colors"
                    >
                      ↻ Try again · Riprova
                    </button>

                  </div>
                </motion.div>
              );
            }

            // Normale berichten — ongewijzigd
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[90%] px-3 py-2 rounded-xl text-[0.8rem] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-white/5 border border-white/10 rounded-br-none italic text-white/80'
                    : 'bg-gradient-to-br from-[#4a7ab5]/10 to-[#4a7ab5]/5 border border-[#4a7ab5]/20 rounded-bl-none'
                }`}>
                  {msg.role === 'model' ? (
                    <>
                      <span className="font-serif italic text-base text-[#7ab4e8] block mb-0.5">{msg.en}</span>
                      <span className="text-[0.65rem] text-white/40 block leading-tight">{msg.it}</span>
                    </>
                  ) : (
                    <>
                      <span>{msg.en}</span>
                      {msg.score !== undefined && (
                        <div className={`mt-1.5 text-[0.55rem] font-bold uppercase px-1.5 py-0.5 rounded-sm inline-block ${
                          msg.score === 2 ? 'bg-green-500/10 text-green-400'
                          : msg.score === 1 ? 'bg-yellow-500/10 text-yellow-400'
                          : 'bg-red-500/10 text-red-400'
                        }`}>
                          {msg.score === 2 ? '✓ Brilliant!' : msg.score === 1 ? '~ Almost!' : '↻ Try again'}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}

          {isThinking && (
            <div className="flex gap-1.5 p-2 bg-[#4a7ab5]/5 border border-[#4a7ab5]/10 rounded-xl rounded-bl-none w-12">
              <div className="w-1 h-1 bg-[#7ab4e8] rounded-full animate-bounce" />
              <div className="w-1 h-1 bg-[#7ab4e8] rounded-full animate-bounce [animation-delay:0.2s]" />
              <div className="w-1 h-1 bg-[#7ab4e8] rounded-full animate-bounce [animation-delay:0.4s]" />
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Bottom */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-[#4a7ab5]/10 pb-3">
            <div className="flex items-center gap-1.5 text-[#4a7ab5]/60 text-[0.6rem] uppercase tracking-widest"><Trophy size={12} /> Score · Punteggio</div>
            <div className="text-[#7ab4e8] font-bold text-lg">⭐ {score}</div>
          </div>

          <button type="button" onClick={startNewConversation}
            className="w-full py-3 border border-[#4a7ab5]/30 bg-[#4a7ab5]/5 rounded-xl text-[0.7rem] tracking-[0.2em] uppercase text-[#7ab4e8] hover:bg-[#4a7ab5]/10 flex flex-col items-center justify-center gap-1">
            <div className="flex items-center gap-2"><RotateCcw size={14} /> New Conversation</div>
            <span className="text-[0.55rem] opacity-60">Nuova conversazione</span>
          </button>

          <div className="flex gap-2">
            <button type="button" onClick={downloadTranscript}
              className="flex-1 py-2 border border-[#4a7ab5]/10 rounded-lg text-[0.6rem] tracking-widest uppercase text-[#4a7ab5]/60 hover:text-[#7ab4e8] flex flex-col items-center gap-0.5">
              <div className="flex items-center gap-1"><Save size={12} /> Save</div>
              <span className="text-[0.45rem] opacity-60">Salva trascrizione</span>
            </button>
            <button type="button" onClick={() => setShowKeyModal(true)}
              className="px-4 py-2 border border-[#4a7ab5]/10 rounded-lg text-[0.6rem] text-[#4a7ab5]/60 hover:text-[#7ab4e8] flex flex-col items-center gap-0.5">
              <Key size={12} />
              <span className="text-[0.45rem] opacity-60 uppercase tracking-widest">API</span>
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showKeyModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-[#12122a] border border-[#4a7ab5]/30 p-6 rounded-2xl w-full max-w-xs shadow-2xl">
              <h2 className="font-serif text-xl text-[#7ab4e8] mb-1 text-center">Gemini API Key</h2>
              <p className="text-[0.6rem] text-[#4a7ab5]/60 text-center mb-3">Separate key from other mirrors · Chiave separata</p>
              <input type="password" defaultValue={customKey} id="keyInput" className="w-full bg-black/40 border border-[#4a7ab5]/20 rounded-lg px-4 py-2.5 text-sm mb-4 outline-none text-white" />
              <div className="flex gap-2">
                <button onClick={() => setShowKeyModal(false)} className="flex-1 py-2 text-xs text-[#4a7ab5]/50 border border-transparent rounded-lg">Cancel</button>
                <button onClick={() => { saveCustomKey((document.getElementById('keyInput') as HTMLInputElement).value); }}
                  className="flex-1 py-2 bg-gradient-to-r from-[#4a7ab5] to-[#1a3a6a] rounded-lg text-white text-xs font-bold">Save</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <GuidaSection accentColor="#4a7ab5" />
      <div style={{
        textAlign: 'center',
        padding: '1.5rem 1rem 2rem',
        fontSize: '0.72rem',
        lineHeight: 1.8,
        color: 'white',
        opacity: 0.85,
      }}>
        🇮🇹 Questa app è gratuita. Se la usi spesso, ti consigliamo di creare la tua chiave API personale — è facile e gratuita su aistudio.google.com.<br /><br />
        🇳🇱 Deze app is gratis. Gebruik je hem regelmatig, maak dan je eigen API-sleutel aan — eenvoudig en gratis via aistudio.google.com.<br /><br />
        🇬🇧 This app is free to use. If you use it regularly, we recommend creating your own API key — quick and free at aistudio.google.com.
      </div>
    </div>
  );
}
