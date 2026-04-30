import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const anthropicUrl = 'https://api.anthropic.com/v1/messages';
const defaultModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

app.use(express.json({ limit: '1mb' }));

app.post('/api/chat', async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured' });
  }

  const { system, messages, max_tokens = 1024 } = req.body || {};
  if (typeof system !== 'string' || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Expected { system, messages }' });
  }

  try {
    const response = await fetch(anthropicUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: defaultModel,
        max_tokens,
        system,
        messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || 'Anthropic API error' });
    }

    const text = data.content?.map(part => part.text || '').join('') || '';
    return res.json({ text });
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
  console.log(`Behavioral Advisor listening on port ${port}${isDev ? ' (dev)' : ''}`);
});
