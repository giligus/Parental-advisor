let currentAudio = null;
let currentSource = null;
let currentAudioContext = null;
let currentStreamAbort = null;

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

export async function playElevenLabsStreamInput(text, voiceId, onStart, onEnd, options = {}) {
  if (options.skipStream) return false;
  if (!supportsProgressiveAudio()) return false;

  const controller = new AbortController();
  currentStreamAbort?.abort();
  currentStreamAbort = controller;

  let objectUrl = '';
  let ended = false;
  let started = false;
  const queue = [];

  try {
    const mediaSource = new MediaSource();
    objectUrl = URL.createObjectURL(mediaSource);
    const audio = new Audio(objectUrl);
    currentAudio = audio;

    const done = new Promise(resolve => {
      audio.onended = () => {
        cleanupStreamAudio(objectUrl);
        onEnd?.();
        resolve(true);
      };
      audio.onerror = () => {
        cleanupStreamAudio(objectUrl);
        onEnd?.();
        resolve(false);
      };
    });

    await new Promise((resolve, reject) => {
      mediaSource.addEventListener('sourceopen', resolve, { once: true });
      mediaSource.addEventListener('error', reject, { once: true });
    });

    const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
    const appendNext = () => {
      if (sourceBuffer.updating || !queue.length) return;
      sourceBuffer.appendBuffer(queue.shift());
    };

    sourceBuffer.addEventListener('updateend', () => {
      if (!started) {
        started = true;
        onStart?.();
        audio.play().catch(error => {
          console.warn('Stream audio play failed:', error);
        });
      }
      appendNext();
      if (ended && !sourceBuffer.updating && !queue.length && mediaSource.readyState === 'open') {
        mediaSource.endOfStream();
      }
    });

    const response = await fetch('/api/tts-stream-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      console.warn('TTS stream-input failed:', await readError(response));
      cleanupStreamAudio(objectUrl);
      return false;
    }

    const reader = response.body.getReader();
    while (true) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      if (value?.length) {
        queue.push(value);
        appendNext();
      }
    }

    ended = true;
    if (!sourceBuffer.updating && !queue.length && mediaSource.readyState === 'open') {
      mediaSource.endOfStream();
    }

    return await done;
  } catch (error) {
    if (error?.name !== 'AbortError') console.warn('Streaming TTS failed:', error);
    cleanupStreamAudio(objectUrl);
    return false;
  }
}

export async function callLLMVoiceStream({ system, messages, voiceId, lang, onText, onStart, onEnd }) {
  const hasAudioContext = typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);
  if (!voiceId || !hasAudioContext) {
    return { ok: false, text: '' };
  }

  const controller = new AbortController();
  currentStreamAbort?.abort();
  currentStreamAbort = controller;

  let fullText = '';
  let streamPlayer = null;

  try {
    const response = await fetch('/api/chat-voice-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system,
        messages,
        voiceId,
        lang,
        max_tokens: 420,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      return { ok: false, text: '', error: await readError(response) };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'text' && event.delta) {
          fullText += event.delta;
          onText?.(event.delta, fullText);
        } else if (event.type === 'audio' && event.audio) {
          if (!streamPlayer) {
            streamPlayer = createPcmPlayer(event.sampleRate || 16000, onStart);
          }
          streamPlayer.push(base64ToBytes(event.audio));
        } else if (event.type === 'done') {
          fullText = event.text || fullText;
        } else if (event.type === 'error') {
          throw new Error(event.error || 'Voice stream failed');
        }
      }
    }

    streamPlayer?.finish(onEnd);
    if (!streamPlayer) onEnd?.();

    return { ok: true, text: fullText.trim() };
  } catch (error) {
    if (error?.name !== 'AbortError') console.warn('LLM voice stream failed:', error);
    streamPlayer?.stop();
    onEnd?.();
    return { ok: false, text: fullText.trim(), error: error?.message };
  }
}

async function readError(response) {
  try {
    const data = await response.json();
    return data?.error || JSON.stringify(data);
  } catch {
    try {
      return await response.text();
    } catch {
      return `HTTP ${response.status}`;
    }
  }
}

function createPcmPlayer(sampleRate, onStart) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  currentAudioContext?.close();
  currentAudioContext = ctx;

  let nextTime = ctx.currentTime + 0.03;
  let started = false;
  let finishTimer = null;

  const push = bytes => {
    const samples = pcm16ToFloat32(bytes);
    if (!samples.length) return;

    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    currentSource = source;

    const startAt = Math.max(nextTime, ctx.currentTime + 0.02);
    source.start(startAt);
    nextTime = startAt + buffer.duration;

    if (!started) {
      started = true;
      onStart?.();
    }
  };

  return {
    push,
    finish: onEnd => {
      clearTimeout(finishTimer);
      const delay = Math.max(80, (nextTime - ctx.currentTime) * 1000 + 80);
      finishTimer = setTimeout(() => {
        currentSource = null;
        currentAudioContext = null;
        ctx.close();
        onEnd?.();
      }, delay);
    },
    stop: () => {
      clearTimeout(finishTimer);
      try {
        currentSource?.stop();
      } catch {}
      currentSource = null;
      currentAudioContext = null;
      ctx.close();
    },
  };
}

function pcm16ToFloat32(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.max(-1, Math.min(1, view.getInt16(i * 2, true) / 32768));
  }
  return samples;
}

function supportsProgressiveAudio() {
  return typeof window !== 'undefined' &&
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported?.('audio/mpeg');
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function cleanupStreamAudio(objectUrl) {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute('src');
    currentAudio.load();
    currentAudio = null;
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  currentStreamAbort = null;
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
  currentStreamAbort?.abort();
  cleanupStreamAudio();
  try {
    currentSource?.stop();
  } catch {}
  currentSource = null;
  currentAudioContext?.close();
  currentAudioContext = null;
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
    currentAudioContext?.close();
    currentAudioContext = ctx;
    currentSource = source;
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      currentSource = null;
      currentAudioContext = null;
      onEnd?.();
      ctx.close();
    };
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
