// ── LLM — routes through server.js proxy ─────────────
// server.js handles Anthropic / OpenAI switching via LLM_PROVIDER env var
// API keys stay server-side only — never exposed to the browser
export async function callLLM(system, messages) {
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages, max_tokens: 1024 }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error || `Server error ${r.status}`);
  }
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.text || '';
}

// ── ElevenLabs TTS ────────────────────────────────────
export async function elevenLabsSpeak(text, voiceId) {
  const key = import.meta.env.VITE_ELEVENLABS_API_KEY;
  if (!key) return null;

  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify({
          text,
          model_id: 'eleven_flash_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
        }),
      }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return data; // { audio_base64, alignment }
  } catch { return null; }
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
