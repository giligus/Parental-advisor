# Behavioral Advisor Webapp

A chat-first behavioral advisor built with React, Vite, and a small Node/Express production server. The browser never calls Anthropic directly; it talks to `/api/chat`, and the server uses `ANTHROPIC_API_KEY`.

## What It Includes

- Natural chat-first advisor flow
- Natural Conversation Router before event extraction
- Case memory, profiles, state tracking, and advisor synthesis
- Practice/simulation mode
- Animated advisor avatar
- Browser voice and mic controls where supported
- Hebrew/English and dark/light commands
- Memory export, clear memory, and reset session view controls

## Architecture

```text
User Input
  -> Conversation Type Detector
  -> Natural Conversation Router
  -> Context Sufficiency Check
  -> Event Understanding when needed
  -> Case Memory
  -> State Engine
  -> Policy Engine
  -> Advisor Synthesis
  -> Persona Naturalizer
  -> User Response
```

The key product rule is: first human, then methodological. Greetings and small talk stay conversational, partial event reports ask one clarification, full events update memory/state, and explicit big-picture requests trigger synthesis.

## Local Development

Install dependencies:

```bash
npm install
```

Create a local `.env` file if you want live AI responses:

```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

Run the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

If `ANTHROPIC_API_KEY` is not set, the UI still runs and falls back to local advisor text.

## Production Check

```bash
npm run build
npm start
```

`npm start` serves the built Vite app from `dist/` and exposes `POST /api/chat`.

## Railway Deployment

Set these environment variables in Railway:

```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

Railway should run:

```bash
npm run build
npm start
```

The included `railway.json` sets the start command to `npm start`.

## Security Notes

- Do not use `VITE_ANTHROPIC_API_KEY`.
- Do not call Anthropic from browser code.
- Keep API keys server-side through `server.js` and `/api/chat`.
- Case memory is stored locally in the browser via `localStorage`; users can export or clear it from the Status screen.

## Scripts

```bash
npm run dev      # Vite dev app through server.js middleware
npm run build    # Production Vite build
npm start        # Express server for Railway/local production
```

