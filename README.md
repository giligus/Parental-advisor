# Behavioral Advisor — Virtual Persona

A conference-style behavioral advisor web app with animated character personas, natural speech (ElevenLabs or Web Speech API), and LLM-powered conversation.

## Demo

- Select Maya (female) or Adam (male) as your advisor
- The character appears full-screen in a video-call style layout
- Speaks responses aloud (Hebrew or English)
- Bobs, glows, and pulses when speaking
- Chat panel below for the conversation

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/behavioral-advisor.git
cd behavioral-advisor
npm install
cp .env.example .env
# Add your keys to .env
npm run dev
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_ANTHROPIC_API_KEY` | Yes | From [console.anthropic.com](https://console.anthropic.com) |
| `VITE_ELEVENLABS_API_KEY` | Optional | From [elevenlabs.io](https://elevenlabs.io) — for natural Hebrew voice. Falls back to Web Speech API if not set. |

## Deploy to Railway

1. Push to GitHub
2. Go to [railway.com](https://railway.com) → New Project → Deploy from GitHub repo
3. Add environment variables in the Railway Variables tab
4. Click Deploy — live in ~60 seconds

## Install as Phone App

1. Open the deployed URL in Safari (iOS) or Chrome (Android)
2. iOS: Share → Add to Home Screen
3. Android: Menu → Add to Home Screen

## Voice Quality

| Setup | Quality | Cost |
|-------|---------|------|
| Web Speech API only | Robotic, OS-dependent | Free |
| + ElevenLabs Flash v2.5 | Natural, human-like Hebrew | ~$5/month starter |

## Project Structure

```
src/
  App.jsx           # Root — screen routing + mobile height fix
  PersonaSelect.jsx # Character selection screen
  Advisor.jsx       # Conference-style advisor with avatar + chat
  Waveform.jsx      # Animated audio waveform bars
  api.js            # LLM + ElevenLabs + Web Speech + history helpers
  personas.js       # Persona definitions (names, colors, voice IDs)
  index.css         # Global styles + animations

public/
  maya.png          # Female advisor character illustration
  adam.png          # Male advisor character illustration
  icon.svg          # App icon
```
