// server.js — LLM proxy server
// Supports: Anthropic (claude-sonnet-4-20250514) and OpenAI (gpt-4.1 / gpt-4.1-mini)
// Switch provider with: LLM_PROVIDER=anthropic|openai in .env

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
app.use(express.json({ limit: '10mb' }));

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ── Config from env ───────────────────────────────────
const PROVIDER      = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const OPENAI_KEY    = process.env.OPENAI_API_KEY    || '';
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
const ELEVENLABS_MODEL_HE = process.env.ELEVENLABS_MODEL_HE || 'eleven_v3';
const ELEVENLABS_STREAM_MODEL = process.env.ELEVENLABS_STREAM_MODEL || 'eleven_flash_v2_5';
const ELEVENLABS_STREAM_MODEL_HE = process.env.ELEVENLABS_STREAM_MODEL_HE || 'eleven_flash_v2_5';
const ELEVENLABS_STT_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';
const ELEVENLABS_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_22050_32';
const ELEVENLABS_STREAM_OUTPUT_FORMAT = process.env.ELEVENLABS_STREAM_OUTPUT_FORMAT || 'pcm_16000';
const OPENAI_STT_MODEL = process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe';

// Model selection — can override via env
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
// gpt-4.1 = best quality, gpt-4.1-mini = faster + cheaper
const OPENAI_MODEL    = process.env.OPENAI_MODEL    || 'gpt-4.1-mini';

console.log(`[server] Provider: ${PROVIDER}`);
console.log(`[server] Model: ${PROVIDER === 'anthropic' ? ANTHROPIC_MODEL : OPENAI_MODEL}`);

function looksHebrew(text = '') {
  return /[\u0590-\u05FF]/.test(text);
}

function supportsElevenLanguageCode(modelId = '') {
  return /eleven_v3/i.test(modelId);
}

function splitTextForStreaming(text = '') {
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const sentences = cleaned.match(/[^.!?…]+[.!?…]?/g)?.map(item => item.trim()).filter(Boolean) || [cleaned];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length <= 160) {
      current = next;
    } else {
      if (current) chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);

  return chunks.flatMap(chunk => {
    if (chunk.length <= 220) return [chunk];
    const words = chunk.split(' ');
    const parts = [];
    let part = '';
    for (const word of words) {
      const next = part ? `${part} ${word}` : word;
      if (next.length <= 180) part = next;
      else {
        if (part) parts.push(part);
        part = word;
      }
    }
    if (part) parts.push(part);
    return parts;
  });
}

async function parseWsMessage(data) {
  if (typeof data === 'string') return JSON.parse(data);
  if (data instanceof Blob) return JSON.parse(await data.text());
  if (data instanceof ArrayBuffer) return JSON.parse(Buffer.from(data).toString('utf8'));
  return JSON.parse(Buffer.from(data).toString('utf8'));
}

async function* readSseData(response) {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      const data = event
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
        .trim();
      if (!data) continue;
      if (data === '[DONE]') return;
      yield data;
    }
  }
}

async function streamAnthropic(system, messages, maxTokens, onDelta) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY not set');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || `Anthropic HTTP ${response.status}`);
  }

  for await (const data of readSseData(response)) {
    const event = JSON.parse(data);
    const text = event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta'
      ? event.delta.text
      : '';
    if (text) await onDelta(text);
  }
}

async function streamOpenAI(system, messages, maxTokens, onDelta) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY not set');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
      temperature: 0.7,
      stream: true,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);
  }

  for await (const data of readSseData(response)) {
    const event = JSON.parse(data);
    const text = event?.choices?.[0]?.delta?.content || '';
    if (text) await onDelta(text);
  }
}

function createElevenStream({ textHint, voiceId, outputFormat = ELEVENLABS_OUTPUT_FORMAT, onAudio, onError }) {
  const isHebrew = looksHebrew(textHint);
  const modelId = isHebrew ? ELEVENLABS_STREAM_MODEL_HE : ELEVENLABS_STREAM_MODEL;
  const languageCode = isHebrew ? 'he' : 'en';
  const url = new URL(`wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream-input`);
  url.searchParams.set('model_id', modelId);
  if (supportsElevenLanguageCode(modelId)) url.searchParams.set('language_code', languageCode);
  url.searchParams.set('output_format', outputFormat);
  url.searchParams.set('auto_mode', 'true');
  url.searchParams.set('sync_alignment', 'false');
  url.searchParams.set('inactivity_timeout', '60');

  const ws = new WebSocket(url);
  let closed = false;

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        text: ' ',
        xi_api_key: ELEVENLABS_KEY,
        voice_settings: {
          stability: isHebrew ? 0.38 : 0.5,
          similarity_boost: 0.82,
          style: isHebrew ? 0.45 : 0.3,
          use_speaker_boost: true,
        },
        generation_config: {
          chunk_length_schedule: [25, 45, 75, 110],
        },
      }));
      resolve();
    }, { once: true });
    ws.addEventListener('error', () => reject(new Error('ElevenLabs WebSocket error')), { once: true });
  });

  const done = new Promise(resolve => {
    ws.addEventListener('message', async event => {
      try {
        const data = await parseWsMessage(event.data);
        if (data?.audio) onAudio(data.audio);
        if (data?.isFinal) {
          closed = true;
          resolve();
          if (ws.readyState === WebSocket.OPEN) ws.close();
        }
      } catch (err) {
        onError?.(err);
      }
    });
    ws.addEventListener('close', () => {
      closed = true;
      resolve();
    });
    ws.addEventListener('error', () => {
      closed = true;
      onError?.(new Error('ElevenLabs WebSocket error'));
      resolve();
    });
  });

  return {
    opened,
    done,
    send: text => {
      if (!closed && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ text: `${text} `, try_trigger_generation: true }));
      }
    },
    close: () => {
      if (!closed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ text: '' }));
    },
    abort: () => {
      closed = true;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    },
  };
}

function shouldFlushTts(text = '', isFirst = false) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return /[.!?…:;؟]$/.test(trimmed) ||
    trimmed.length >= (isFirst ? 28 : 48) ||
    wordCount >= (isFirst ? 4 : 7);
}

function audioExtension(mimeType = '') {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('m4a')) return 'm4a';
  return 'webm';
}

async function transcribeWithElevenLabs(audio, mimeType, lang) {
  if (!ELEVENLABS_KEY) throw new Error('ELEVENLABS_API_KEY is not configured');

  const form = new FormData();
  form.append('model_id', ELEVENLABS_STT_MODEL);
  form.append('language_code', lang === 'he' ? 'he' : 'en');
  form.append('timestamps_granularity', 'none');
  form.append('tag_audio_events', 'false');
  form.append('file', new Blob([audio], { type: mimeType }), `speech.${audioExtension(mimeType)}`);

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_KEY },
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.detail?.message || data?.message || `ElevenLabs STT HTTP ${response.status}`);
  }

  return {
    text: data?.text || '',
    languageCode: data?.language_code || null,
    model: ELEVENLABS_STT_MODEL,
    provider: 'elevenlabs',
  };
}

async function transcribeWithOpenAI(audio, mimeType, lang) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY is not configured');

  const form = new FormData();
  form.append('model', OPENAI_STT_MODEL);
  form.append('language', lang === 'he' ? 'he' : 'en');
  form.append('response_format', 'json');
  form.append('file', new Blob([audio], { type: mimeType }), `speech.${audioExtension(mimeType)}`);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI STT HTTP ${response.status}`);
  }

  return {
    text: data?.text || '',
    languageCode: lang === 'he' ? 'he' : 'en',
    model: OPENAI_STT_MODEL,
    provider: 'openai',
  };
}

// ── Anthropic call ────────────────────────────────────
async function callAnthropic(system, messages, maxTokens) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic HTTP ${res.status}`);
  return data.content?.find(c => c.type === 'text')?.text || '';
}

// ── OpenAI call ───────────────────────────────────────
async function callOpenAI(system, messages, maxTokens) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY not set');

  // OpenAI uses { role: 'system', content } as first message
  const openaiMessages = [
    { role: 'system', content: system },
    ...messages,
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model:      OPENAI_MODEL,
      max_tokens: maxTokens,
      messages:   openaiMessages,
      // Slightly lower temperature for consistent advisor tone
      temperature: 0.7,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${res.status}`);
  return data.choices?.[0]?.message?.content || '';
}

// ── /api/chat endpoint ────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { system, messages, max_tokens = 1024 } = req.body;

  if (!system || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing system or messages' });
  }

  try {
    let text;

    if (PROVIDER === 'openai') {
      text = await callOpenAI(system, messages, max_tokens);
    } else {
      // Default: Anthropic
      text = await callAnthropic(system, messages, max_tokens);
    }

    res.json({ text, provider: PROVIDER });

  } catch (err) {
    console.error(`[/api/chat] ${PROVIDER} error:`, err.message);

    // Categorize error for the client
    const msg = err.message || '';
    const isQuota   = /quota|billing|rate.limit|429|insufficient/i.test(msg);
    const isAuth    = /auth|api.key|unauthorized|401/i.test(msg);
    const isTimeout = /timeout|ETIMEDOUT/i.test(msg);

    const category = isQuota ? 'quota' : isAuth ? 'auth' : isTimeout ? 'timeout' : 'error';

    res.status(500).json({
      error: msg,
      category,
      provider: PROVIDER,
    });
  }
});

app.post('/api/chat-voice-stream', async (req, res) => {
  const { system, messages, voiceId, lang, max_tokens = 420 } = req.body || {};

  if (!system || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing system or messages' });
  }
  if (!ELEVENLABS_KEY || !voiceId) {
    return res.status(400).json({ error: 'Missing ElevenLabs configuration or voiceId' });
  }

  let closed = false;
  let fullText = '';
  let ttsBuffer = '';
  let ttsChunksSent = 0;
  let eventId = 0;

  const writeEvent = event => {
    if (closed || res.destroyed) return;
    res.write(`${JSON.stringify({ id: eventId += 1, ...event })}\n`);
  };

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'Transfer-Encoding': 'chunked',
    'X-Accel-Buffering': 'no',
  });

  const tts = createElevenStream({
    textHint: lang === 'he' ? 'שלום' : 'Hello',
    voiceId,
    outputFormat: ELEVENLABS_STREAM_OUTPUT_FORMAT,
    onAudio: audio => writeEvent({
      type: 'audio',
      audio,
      format: ELEVENLABS_STREAM_OUTPUT_FORMAT,
      sampleRate: ELEVENLABS_STREAM_OUTPUT_FORMAT.startsWith('pcm_')
        ? Number(ELEVENLABS_STREAM_OUTPUT_FORMAT.split('_')[1]) || 16000
        : null,
    }),
    onError: error => writeEvent({ type: 'warning', message: error.message || 'TTS stream warning' }),
  });

  res.on('close', () => {
    if (!res.writableEnded) {
      closed = true;
      tts.abort();
    }
  });

  try {
    await tts.opened;

    const flushTts = force => {
      const text = ttsBuffer.trim();
      if (!text) return;
      if (!force && !shouldFlushTts(text, ttsChunksSent === 0)) return;
      tts.send(text);
      ttsBuffer = '';
      ttsChunksSent += 1;
    };

    const handleDelta = async delta => {
      fullText += delta;
      ttsBuffer += delta;
      writeEvent({ type: 'text', delta });
      flushTts(false);
    };

    if (PROVIDER === 'openai') {
      await streamOpenAI(system, messages, max_tokens, handleDelta);
    } else {
      await streamAnthropic(system, messages, max_tokens, handleDelta);
    }

    flushTts(true);
    tts.close();
    await tts.done;
    writeEvent({ type: 'done', text: fullText, provider: PROVIDER });
    res.end();
  } catch (err) {
    console.error(`[/api/chat-voice-stream] ${PROVIDER} error:`, err.message);
    tts.abort();
    if (!closed) {
      writeEvent({ type: 'error', error: err.message || 'Voice stream failed', provider: PROVIDER });
      res.end();
    }
  }
});

app.post('/api/tts', async (req, res) => {
  const { text, voiceId } = req.body || {};
  if (!ELEVENLABS_KEY) {
    return res.status(503).json({ error: 'ELEVENLABS_API_KEY is not configured' });
  }
  if (!text || !voiceId) {
    return res.status(400).json({ error: 'Missing text or voiceId' });
  }

  try {
    const isHebrew = looksHebrew(text);
    const modelId = isHebrew ? ELEVENLABS_MODEL_HE : ELEVENLABS_MODEL;
    const languageCode = isHebrew ? 'he' : 'en';
    const eleven = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${encodeURIComponent(ELEVENLABS_OUTPUT_FORMAT)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_KEY,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        ...(supportsElevenLanguageCode(modelId) ? { language_code: languageCode } : {}),
        apply_text_normalization: 'auto',
        voice_settings: {
          stability: isHebrew ? 0.38 : 0.5,
          similarity_boost: 0.82,
          style: isHebrew ? 0.45 : 0.3,
          use_speaker_boost: true,
        },
      }),
    });

    if (!eleven.ok) {
      const raw = await eleven.text();
      let data = {};
      try {
        data = JSON.parse(raw);
      } catch {
        data = { message: raw };
      }
      return res.status(eleven.status).json({
        error: data?.detail?.message || data?.message || 'ElevenLabs API error',
        model: modelId,
        languageCode,
      });
    }

    const audio = Buffer.from(await eleven.arrayBuffer()).toString('base64');
    return res.json({ audio_base64: audio, model: modelId, languageCode });
  } catch (err) {
    console.error('[/api/tts] ElevenLabs error:', err.message);
    return res.status(500).json({ error: 'ElevenLabs proxy failed' });
  }
});

app.post('/api/tts-stream-input', async (req, res) => {
  const { text, voiceId } = req.body || {};
  if (!ELEVENLABS_KEY) {
    return res.status(503).json({ error: 'ELEVENLABS_API_KEY is not configured' });
  }
  if (!text || !voiceId) {
    return res.status(400).json({ error: 'Missing text or voiceId' });
  }

  const chunks = splitTextForStreaming(text);
  if (!chunks.length) {
    return res.status(400).json({ error: 'No text to stream' });
  }

  const isHebrew = looksHebrew(text);
  const modelId = isHebrew ? ELEVENLABS_MODEL_HE : ELEVENLABS_MODEL;
  const languageCode = isHebrew ? 'he' : 'en';
  const url = new URL(`wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream-input`);
  url.searchParams.set('model_id', modelId);
  if (supportsElevenLanguageCode(modelId)) url.searchParams.set('language_code', languageCode);
  url.searchParams.set('output_format', ELEVENLABS_OUTPUT_FORMAT);
  url.searchParams.set('auto_mode', 'true');
  url.searchParams.set('sync_alignment', 'false');
  url.searchParams.set('inactivity_timeout', '30');

  let headersSent = false;
  let settled = false;
  let ws;

  const fail = (status, error) => {
    if (settled) return;
    settled = true;
    if (!headersSent) return res.status(status).json({ error, model: modelId, languageCode });
    console.error('[/api/tts-stream-input]', error);
    res.end();
  };

  try {
    ws = new WebSocket(url);
  } catch (err) {
    return fail(500, err.message || 'Could not create ElevenLabs stream');
  }

  res.on('close', () => {
    if (!settled && ws?.readyState === WebSocket.OPEN) ws.close();
  });

  ws.addEventListener('open', () => {
    headersSent = true;
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store, no-transform',
      'Transfer-Encoding': 'chunked',
      'X-Accel-Buffering': 'no',
      'X-ElevenLabs-Model': modelId,
      'X-ElevenLabs-Language': languageCode,
    });

    ws.send(JSON.stringify({
      text: ' ',
      xi_api_key: ELEVENLABS_KEY,
      voice_settings: {
        stability: isHebrew ? 0.38 : 0.5,
        similarity_boost: 0.82,
        style: isHebrew ? 0.45 : 0.3,
        use_speaker_boost: true,
      },
      generation_config: {
        chunk_length_schedule: [50, 90, 130, 180],
      },
    }));

    for (const chunk of chunks) {
      ws.send(JSON.stringify({ text: `${chunk} `, try_trigger_generation: true }));
    }
    ws.send(JSON.stringify({ text: '' }));
  });

  ws.addEventListener('message', async event => {
    try {
      const data = await parseWsMessage(event.data);
      if (data?.audio) {
        res.write(Buffer.from(data.audio, 'base64'));
      }
      if (data?.isFinal) {
        settled = true;
        res.end();
        if (ws.readyState === WebSocket.OPEN) ws.close();
      }
    } catch (err) {
      fail(500, err.message || 'Invalid ElevenLabs stream message');
    }
  });

  ws.addEventListener('error', event => {
    fail(502, event?.message || 'ElevenLabs WebSocket error');
  });

  ws.addEventListener('close', () => {
    if (!settled) {
      settled = true;
      res.end();
    }
  });
});

app.post('/api/stt', async (req, res) => {
  const { audioBase64, mimeType = 'audio/webm', lang } = req.body || {};
  if (!ELEVENLABS_KEY && !OPENAI_KEY) {
    return res.status(503).json({ error: 'No speech-to-text provider is configured' });
  }
  if (!audioBase64) {
    return res.status(400).json({ error: 'Missing audio' });
  }

  try {
    const audio = Buffer.from(audioBase64, 'base64');
    if (audio.length < 500) {
      return res.status(400).json({ error: 'Audio is too short' });
    }

    const errors = [];
    if (ELEVENLABS_KEY) {
      try {
        const result = await transcribeWithElevenLabs(audio, mimeType, lang);
        return res.json(result);
      } catch (error) {
        errors.push(`ElevenLabs: ${error.message}`);
        console.warn('[/api/stt] ElevenLabs failed, trying fallback:', error.message);
      }
    }

    if (OPENAI_KEY) {
      try {
        const result = await transcribeWithOpenAI(audio, mimeType, lang);
        return res.json({ ...result, fallbackFrom: errors.length ? 'elevenlabs' : null });
      } catch (error) {
        errors.push(`OpenAI: ${error.message}`);
      }
    }

    return res.status(502).json({ error: errors.join(' | ') || 'Speech-to-text failed' });
  } catch (err) {
    console.error('[/api/stt] error:', err.message);
    return res.status(500).json({ error: err.message || 'Speech-to-text proxy failed' });
  }
});

// ── /api/config — lets the client know which provider is active ──
app.get('/api/config', (req, res) => {
  res.json({
    provider: PROVIDER,
    model: PROVIDER === 'openai' ? OPENAI_MODEL : ANTHROPIC_MODEL,
    hasKey: PROVIDER === 'openai' ? !!OPENAI_KEY : !!ANTHROPIC_KEY,
    hasTtsKey: !!ELEVENLABS_KEY,
    ttsModel: ELEVENLABS_MODEL,
    ttsModelHe: ELEVENLABS_MODEL_HE,
    ttsStreamModel: ELEVENLABS_STREAM_MODEL,
    ttsStreamModelHe: ELEVENLABS_STREAM_MODEL_HE,
    sttModel: ELEVENLABS_STT_MODEL,
    ttsOutputFormat: ELEVENLABS_OUTPUT_FORMAT,
    ttsStreamOutputFormat: ELEVENLABS_STREAM_OUTPUT_FORMAT,
  });
});

if (isDev) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  // ── Serve built frontend ──────────────────────────────
  app.use(express.static(path.join(__dirname, 'dist')));

  // ── SPA fallback ──────────────────────────────────────
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

const PORT = process.env.PORT || (isDev ? 3010 : 3001);
app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}${isDev ? ' (dev)' : ''}`);
  console.log(`[server] Provider: ${PROVIDER} | Model: ${PROVIDER === 'openai' ? OPENAI_MODEL : ANTHROPIC_MODEL}`);
  if (PROVIDER === 'openai' && !OPENAI_KEY)    console.warn('[server] ⚠ OPENAI_API_KEY not set');
  if (PROVIDER === 'anthropic' && !ANTHROPIC_KEY) console.warn('[server] ⚠ ANTHROPIC_API_KEY not set');
  if (!ELEVENLABS_KEY) console.warn('[server] ELEVENLABS_API_KEY not set; using browser speech fallback');
});
