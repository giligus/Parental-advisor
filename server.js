// server.js — LLM proxy server
// Supports: Anthropic (claude-sonnet-4-20250514) and OpenAI (gpt-4.1 / gpt-4.1-mini)
// Switch provider with: LLM_PROVIDER=anthropic|openai in .env

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
app.use(express.json({ limit: '2mb' }));

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ── Config from env ───────────────────────────────────
const PROVIDER      = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const OPENAI_KEY    = process.env.OPENAI_API_KEY    || '';

// Model selection — can override via env
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
// gpt-4.1 = best quality, gpt-4.1-mini = faster + cheaper
const OPENAI_MODEL    = process.env.OPENAI_MODEL    || 'gpt-4.1-mini';

console.log(`[server] Provider: ${PROVIDER}`);
console.log(`[server] Model: ${PROVIDER === 'anthropic' ? ANTHROPIC_MODEL : OPENAI_MODEL}`);

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

// ── /api/config — lets the client know which provider is active ──
app.get('/api/config', (req, res) => {
  res.json({
    provider: PROVIDER,
    model: PROVIDER === 'openai' ? OPENAI_MODEL : ANTHROPIC_MODEL,
    hasKey: PROVIDER === 'openai' ? !!OPENAI_KEY : !!ANTHROPIC_KEY,
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
});
