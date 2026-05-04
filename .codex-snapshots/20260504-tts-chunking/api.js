// ── LLM via server proxy ─────────────────────────────
export async function callLLM(system, messages) {
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      max_tokens: 420,
      system,
      messages,
    }),
  });

  let d = {};
  try {
    d = await r.json();
  } catch {
    d = {};
  }

  if (!r.ok) {
    const detail = d?.error ? `: ${d.error}` : '';
    throw new Error(`API ${r.status}${detail}`);
  }

  return d.text || '';
}

// ── ElevenLabs TTS ────────────────────────────────────
export async function elevenLabsSpeak(text, voiceId) {
  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId }),
    });
    const data = await r.json();
    if (!r.ok) return { error: data?.error || `TTS ${r.status}` };
    return data; // { audio_base64 }
  } catch (error) {
    return { error: error?.message || 'TTS request failed' };
  }
}

// ── Web Speech API TTS (fallback) ─────────────────────
export function webSpeechSpeak(text, lang, onStart, onEnd) {
  if (!window.speechSynthesis) { onEnd?.(); return; }
  window.speechSynthesis.cancel();

  const say = () => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'he' ? 'he-IL' : 'en-US';
    u.rate = 0.9;
    u.pitch = 1.05;
    u.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const match =
      voices.find(v => v.lang.startsWith(lang === 'he' ? 'he' : 'en') && /female|woman|siri|karen|samantha|tessa/i.test(v.name)) ||
      voices.find(v => v.lang.startsWith(lang === 'he' ? 'he' : 'en')) ||
      voices[0];
    if (match) u.voice = match;
    u.onstart = () => onStart?.();
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    window.speechSynthesis.speak(u);
  };

  window.speechSynthesis.getVoices().length > 0
    ? say()
    : window.speechSynthesis.addEventListener('voiceschanged', say, { once: true });
}

export function stopSpeech() {
  window.speechSynthesis?.cancel();
}

export async function transcribeAudioBlob(blob, lang) {
  try {
    const audioBase64 = await blobToBase64(blob);
    const r = await fetch('/api/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64,
        mimeType: blob.type || 'audio/webm',
        lang,
      }),
    });
    const data = await r.json();
    if (!r.ok) return { error: data?.error || `STT ${r.status}` };
    return data; // { text, languageCode }
  } catch (error) {
    return { error: error?.message || 'Speech transcription failed' };
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read audio'));
    reader.readAsDataURL(blob);
  });
}

export function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isSpeechInputSupported() {
  return Boolean(getSpeechRecognition());
}

export function isRecordedSpeechSupported() {
  return typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined';
}

// ── Play ElevenLabs audio buffer ───────────────────────
export async function playAudioBase64(base64, onStart, onEnd) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = await ctx.decodeAudioData(bytes.buffer);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => { onEnd?.(); ctx.close(); };
    onStart?.();
    source.start(0);
    return source;
  } catch (e) {
    console.error('Audio playback error:', e);
    onEnd?.();
    return null;
  }
}

// ── Build clean conversation history ──────────────────
export function buildHistory(msgs) {
  const hist = msgs
    .filter(x => !x.isErr)
    .map(x => ({ role: x.role === 'user' ? 'user' : 'assistant', content: x.text }));
  // Must start with user
  while (hist.length && hist[0].role === 'assistant') hist.shift();
  // Merge consecutive same-role
  const merged = [];
  for (const h of hist) {
    if (merged.length && merged[merged.length - 1].role === h.role) {
      merged[merged.length - 1].content += ' ' + h.content;
    } else {
      merged.push({ ...h });
    }
  }
  return merged.slice(-12);
}
