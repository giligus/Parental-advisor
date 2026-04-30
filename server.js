import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const provider = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();
const anthropicUrl = 'https://api.anthropic.com/v1/messages';
const openaiUrl = 'https://api.openai.com/v1/responses';
const anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

app.use(express.json({ limit: '1mb' }));

function extractOpenAIText(data) {
  if (typeof data.output_text === 'string') return data.output_text;

  return (data.output || [])
    .flatMap(item => item.content || [])
    .map(part => part.text || '')
    .join('');
}

async function callAnthropic({ system, messages, max_tokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { status: 503, error: 'ANTHROPIC_API_KEY is not configured' };
  }

  const response = await fetch(anthropicUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens,
      system,
      messages,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return { status: response.status, error: data?.error?.message || 'Anthropic API error' };
  }

  const text = data.content?.map(part => part.text || '').join('') || '';
  return { text };
}

async function callOpenAI({ system, messages, max_tokens }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { status: 503, error: 'OPENAI_API_KEY is not configured' };
  }

  const response = await fetch(openaiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      instructions: system,
      input: messages.map(message => ({
        role: message.role,
        content: message.content,
      })),
      max_output_tokens: max_tokens,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return { status: response.status, error: data?.error?.message || 'OpenAI API error' };
  }

  return { text: extractOpenAIText(data) };
}

app.post('/api/chat', async (req, res) => {
  const { system, messages, max_tokens = 1024 } = req.body || {};
  if (typeof system !== 'string' || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Expected { system, messages }' });
  }

  try {
    let result;

    if (provider === 'openai') {
      result = await callOpenAI({ system, messages, max_tokens });
    } else if (provider === 'anthropic') {
      result = await callAnthropic({ system, messages, max_tokens });
    } else {
      return res.status(500).json({ error: `Unsupported LLM_PROVIDER "${provider}"` });
    }

    if (result.error) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    return res.json({ text: result.text || '' });
  } catch (error) {
    console.error('API proxy error:', error);
    return res.status(500).json({ error: 'API proxy failed' });
  }
});

if (isDev) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, 'dist')));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Behavioral Advisor listening on port ${port}${isDev ? ' (dev)' : ''} using ${provider}`);
});
