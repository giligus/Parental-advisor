// Voice module — TTS + STT using native Web Speech API
// Phase 3: Voice advisor

// ── Text-to-Speech ─────────────────────────────────
let currentUtterance = null;
let voicesLoaded = false;
let cachedVoices = [];

function loadVoices() {
  return new Promise(resolve => {
    cachedVoices = window.speechSynthesis?.getVoices() || [];
    if (cachedVoices.length > 0) { voicesLoaded = true; resolve(cachedVoices); return; }
    window.speechSynthesis?.addEventListener('voiceschanged', () => {
      cachedVoices = window.speechSynthesis.getVoices();
      voicesLoaded = true;
      resolve(cachedVoices);
    });
    setTimeout(() => resolve(cachedVoices), 2000);
  });
}

function findVoice(lang) {
  if (!voicesLoaded) return null;
  const code = lang === 'he' ? 'he' : 'en';
  // Prefer female voices for advisor persona
  const preferred = cachedVoices.filter(v => v.lang.startsWith(code));
  const female = preferred.find(v => /female|woman|siri|samantha|karen|tessa/i.test(v.name));
  return female || preferred[0] || null;
}

export function isTTSSupported() {
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

export async function initTTS() {
  if (!isTTSSupported()) return false;
  await loadVoices();
  return cachedVoices.length > 0;
}

export function speak(text, lang = 'he', onStart, onEnd, onWord) {
  if (!isTTSSupported()) return;
  stopSpeaking();
  
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = findVoice(lang);
  if (voice) utterance.voice = voice;
  utterance.lang = lang === 'he' ? 'he-IL' : 'en-US';
  utterance.rate = 0.92;
  utterance.pitch = 1.05;
  utterance.volume = 1;
  
  utterance.onstart = () => onStart?.();
  utterance.onend = () => { currentUtterance = null; onEnd?.(); };
  utterance.onerror = () => { currentUtterance = null; onEnd?.(); };
  utterance.onboundary = (e) => {
    if (e.name === 'word') onWord?.(e.charIndex, e.charLength);
  };
  
  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  currentUtterance = null;
}

export function isSpeaking() {
  return window.speechSynthesis?.speaking || false;
}

// ── Speech-to-Text ─────────────────────────────────
let recognition = null;

export function isSTTSupported() {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

export function startListening(lang = 'he', onResult, onEnd, onError) {
  if (!isSTTSupported()) { onError?.('Speech recognition not supported'); return; }
  
  stopListening();
  
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = lang === 'he' ? 'he-IL' : 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  
  let finalTranscript = '';
  
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interim = transcript;
      }
    }
    onResult?.(finalTranscript || interim, !!finalTranscript);
  };
  
  recognition.onend = () => {
    onEnd?.(finalTranscript);
    recognition = null;
  };
  
  recognition.onerror = (event) => {
    if (event.error !== 'aborted') onError?.(event.error);
    recognition = null;
  };
  
  recognition.start();
}

export function stopListening() {
  if (recognition) {
    try { recognition.stop(); } catch (e) { /* ignore */ }
    recognition = null;
  }
}

export function isListening() {
  return recognition !== null;
}
