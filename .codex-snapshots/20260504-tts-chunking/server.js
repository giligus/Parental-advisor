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
const ELEVENLABS_STT_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';

// Model selection — can override via env
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
// gpt-4.1 = best quality, gpt-4.1-mini = faster + cheaper
const OPENAI_MODEL    = process.env.OPENAI_MODEL    || 'gpt-4.1-mini';

console.log(`[server] Provider: ${PROVIDER}`);
console.log(`[server] Model: ${PROVIDER === 'anthropic' ? ANTHROPIC_MODEL : OPENAI_MODEL}`);

function looksHebrew(text = '') {
  return /[\u0590-\u05FF]/.test(text);
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
    const eleven = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_KEY,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        language_code: languageCode,
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

app.post('/api/stt', async (req, res) => {
  const { audioBase64, mimeType = 'audio/webm', lang } = req.body || {};
  if (!ELEVENLABS_KEY) {
    return res.status(503).json({ error: 'ELEVENLABS_API_KEY is not configured' });
  }
  if (!audioBase64) {
    return res.status(400).json({ error: 'Missing audio' });
  }

  try {
    const audio = Buffer.from(audioBase64, 'base64');
    if (audio.length < 800) {
      return res.status(400).json({ error: 'Audio is too short' });
    }

    const form = new FormData();
    form.append('model_id', ELEVENLABS_STT_MODEL);
    form.append('language_code', lang === 'he' ? 'he' : 'en');
    form.append('timestamps_granularity', 'none');
    form.append('tag_audio_events', 'false');
    form.append('file', new Blob([audio], { type: mimeType }), `speech.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);

    const eleven = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_KEY },
      body: form,
    });

    const data = await eleven.json();
    if (!eleven.ok) {
      return res.status(eleven.status).json({
        error: data?.detail?.message || data?.message || 'ElevenLabs speech-to-text error',
        model: ELEVENLABS_STT_MODEL,
      });
    }

    return res.json({
      text: data?.text || '',
      languageCode: data?.language_code || null,
      model: ELEVENLABS_STT_MODEL,
    });
  } catch (err) {
    console.error('[/api/stt] ElevenLabs error:', err.message);
    return res.status(500).json({ error: 'Speech-to-text proxy failed' });
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
    sttModel: ELEVENLABS_STT_MODEL,
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
