import { useState, useEffect, useRef, useCallback } from 'react';
import Waveform from './Waveform';
import { callLLM, elevenLabsSpeak, webSpeechSpeak, stopSpeech, playAudioBase64, buildHistory, getSpeechRecognition, isSpeechInputSupported, isRecordedSpeechSupported, transcribeAudioBlob } from './api';
import { loadAdvisorCase, prepareAdvisorTurn, saveAdvisorCase } from './advisorBrain';

function ProfileField({ label, items }) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) return null;
  return (
    <div style={{ marginTop: 9 }}>
      <div style={{ color: '#6f7c97', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {values.map(item => (
          <span key={item} style={{
            padding: '4px 8px', borderRadius: 999,
            background: 'rgba(255,255,255,0.06)',
            color: '#aeb9cf', fontSize: 12, lineHeight: 1.4,
          }}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function splitSpeechChunks(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  if (cleaned.length <= 120) return [cleaned];

  const sentences = cleaned.match(/[^.!?…]+[.!?…]?/g)?.map(item => item.trim()).filter(Boolean) || [cleaned];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
    } else if (`${current} ${sentence}`.length <= 190) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);

  return chunks.flatMap(chunk => splitLongChunk(chunk, 210)).slice(0, 4);
}

function splitLongChunk(text, maxLength) {
  if (text.length <= maxLength) return [text];
  const words = text.split(' ');
  const chunks = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= maxLength) current = `${current} ${word}`;
    else {
      chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export default function Advisor({ persona, lang, onBack }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [showProfiles, setShowProfiles] = useState(false);
  const [status, setStatus] = useState(lang === 'he' ? 'מקשיב' : 'Listening');
  const [caseData, setCaseData] = useState(() => loadAdvisorCase());
  const chatRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const recorderRef = useRef(null);
  const micStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const speechRunRef = useRef(0);

  const isHe = lang === 'he';
  const ac = persona?.accent || '#4b9cf3';
  const glow = persona?.glow || 'rgba(75,156,243,0.4)';
  const profiles = Object.values(caseData.profiles || {});
  const profilesLabel = isHe ? '\u05e4\u05e8\u05d5\u05e4\u05d9\u05dc\u05d9\u05dd' : 'Profiles';

  const SYS = persona
    ? (isHe
        ? `אתה ${persona.name}, יועץ התנהגותי מומחה. עברית טבעית, חמה, ישירה. 2-4 משפטים. ללא markdown.`
        : `You are ${persona.nameEn}, an expert behavioral advisor. Natural warm English. Default to 1-2 short sentences. No markdown.`)
    : (isHe
        ? 'אתה יועץ התנהגותי. עברית טבעית, חמה. 2-4 משפטים. ללא markdown.'
        : 'Expert behavioral advisor. Natural warm English. Default to 1-2 short sentences. No markdown.');
  const greetingSystem = `${SYS}\nDefault to 1-2 short sentences. ${isHe ? 'Reply in Hebrew.' : ''}`;

  const playBrowserSpeech = useCallback((text, final = true) => new Promise(resolve => {
    webSpeechSpeak(text, lang,
      () => { setSpeaking(true); setStatus(isHe ? 'מדבר...' : 'Speaking...'); },
      () => {
        if (final) {
          setSpeaking(false);
          setStatus(isHe ? 'מקשיב' : 'Listening');
          inputRef.current?.focus();
        }
        resolve();
      }
    );
  }), [isHe, lang]);

  const playElevenLabsChunk = useCallback((data, final = true) => new Promise(resolve => {
    if (!data?.audio_base64) {
      resolve(false);
      return;
    }

    playAudioBase64(data.audio_base64,
      () => { setSpeaking(true); setStatus(isHe ? 'מדבר...' : 'Speaking...'); },
      () => {
        if (final) {
          setSpeaking(false);
          setStatus(isHe ? 'מקשיב' : 'Listening');
          inputRef.current?.focus();
        }
        resolve(true);
      }
    );
  }), [isHe]);

  // Speak a text response using low-latency chunked ElevenLabs or Web Speech fallback
  const doSpeak = useCallback((text) => {
    const runId = speechRunRef.current + 1;
    speechRunRef.current = runId;

    if (!voiceOn) {
      // Animate without audio
      setSpeaking(true);
      setStatus(isHe ? 'מדבר...' : 'Speaking...');
      const dur = Math.max(1800, text.length * 55);
      setTimeout(() => { setSpeaking(false); setStatus(isHe ? 'מקשיב' : 'Listening'); inputRef.current?.focus(); }, dur);
      return;
    }

    if (persona) {
      const voiceId = isHe ? persona.voiceIdHe : persona.voiceId;
      const speechChunks = splitSpeechChunks(text);
      if (!speechChunks.length) return;

      setStatus(isHe ? 'מכינה קול...' : 'Preparing voice...');
      const requests = speechChunks.map(chunk => elevenLabsSpeak(chunk, voiceId));

      (async () => {
        for (let index = 0; index < speechChunks.length; index += 1) {
          if (speechRunRef.current !== runId) return;
          const data = await requests[index];
          if (speechRunRef.current !== runId) return;
          const final = index === speechChunks.length - 1;
          const played = await playElevenLabsChunk(data, final);
          if (!played) {
            console.warn('ElevenLabs unavailable, using browser speech fallback:', data?.error || 'unknown TTS error');
            setStatus(isHe ? 'קול דפדפן' : 'Browser voice');
            await playBrowserSpeech(speechChunks.slice(index).join(' '), true);
            return;
          }
        }
      })();
    } else {
      playBrowserSpeech(text, true);
    }
  }, [voiceOn, persona, isHe, playBrowserSpeech, playElevenLabsChunk]);

  // Greeting
  useEffect(() => {
    setBusy(true);
    setStatus(isHe ? 'חושב...' : 'Thinking...');
    callLLM(greetingSystem, [{ role: 'user', content: isHe ? 'שלום, פתח שיחה חמה וקצרה' : 'Hello, open with a warm brief greeting' }])
      .then(txt => {
        setMsgs([{ role: 'advisor', text: txt }]);
        setBusy(false);
        setTimeout(() => doSpeak(txt), 300);
      })
      .catch(() => {
        const fallback = isHe ? 'שלום! שמחה שאתם פה. מה מעסיק אתכם היום?' : "Hi! Glad you're here. What's on your mind?";
        setMsgs([{ role: 'advisor', text: fallback }]);
        setBusy(false);
        setTimeout(() => doSpeak(fallback), 300);
      });
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [msgs, busy]);

  const send = useCallback(async (overrideText = '') => {
    const m = (typeof overrideText === 'string' && overrideText ? overrideText : input).trim();
    if (!m || busy) return;
    setInput('');
    const updated = [...msgs, { role: 'user', text: m }];
    setMsgs(updated);
    setBusy(true);
    setStatus(isHe ? 'חושב...' : 'Thinking...');
    try {
      const turn = prepareAdvisorTurn({ message: m, caseData, lang, persona });
      setCaseData(turn.caseData);
      saveAdvisorCase(turn.caseData);

      const reply = await callLLM(turn.system, buildHistory(updated));
      setMsgs(p => [...p, { role: 'advisor', text: reply }]);
      setBusy(false);
      doSpeak(reply);
    } catch (error) {
      console.error('Chat request failed:', error);
      const detail = error?.message ? ` (${error.message})` : '';
      const err = isHe
        ? `מצטערת, הייתה בעיה בחיבור ליועץ.${detail}`
        : `Sorry, there was an issue connecting to the advisor.${detail}`;
      setMsgs(p => [...p, { role: 'advisor', text: err, isErr: true }]);
      setBusy(false);
      setStatus(isHe ? 'מקשיב' : 'Listening');
    }
  }, [input, msgs, busy, doSpeak, isHe, caseData, lang, persona]);

  const cleanupRecording = useCallback(() => {
    if (recordTimerRef.current) {
      clearTimeout(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    micStreamRef.current?.getTracks().forEach(track => track.stop());
    micStreamRef.current = null;
  }, []);

  const stopListening = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      return;
    }
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    cleanupRecording();
    setListening(false);
    setStatus(isHe ? 'מקשיב' : 'Listening');
  }, [cleanupRecording, isHe]);

  const startBrowserRecognition = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setStatus(isHe ? 'אין תמיכה במיקרופון' : 'Mic unsupported');
      return;
    }

    let spoken = '';
    const recognition = new SpeechRecognition();
    recognition.lang = isHe ? 'he-IL' : 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      setListening(true);
      setStatus(isHe ? 'מקשיבה לך...' : 'Listening to you...');
    };

    recognition.onresult = event => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      spoken = (finalText || interimText || spoken).trim();
      if (spoken) setInput(spoken);
    };

    recognition.onerror = event => {
      console.warn('Speech recognition failed:', event?.error || event);
      setListening(false);
      setStatus(isHe ? 'לא שמעתי ברור' : 'Could not hear clearly');
      inputRef.current?.focus();
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      setStatus(isHe ? 'מקשיב' : 'Listening');
      if (spoken.trim()) send(spoken.trim());
      else inputRef.current?.focus();
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isHe, send]);

  const startRecordedTranscription = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      micStreamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = event => {
        if (event.data?.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstart = () => {
        setListening(true);
        setStatus(isHe ? 'מקליטה... לחצו לעצירה' : 'Recording... tap to stop');
      };

      recorder.onerror = event => {
        console.warn('Audio recording failed:', event?.error || event);
        cleanupRecording();
        recorderRef.current = null;
        setListening(false);
        setStatus(isHe ? 'בעיה במיקרופון' : 'Mic issue');
      };

      recorder.onstop = async () => {
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        cleanupRecording();
        recorderRef.current = null;
        setListening(false);

        if (blob.size < 1200) {
          setStatus(isHe ? 'לא נקלט קול ברור' : 'No clear audio');
          inputRef.current?.focus();
          return;
        }

        setStatus(isHe ? 'מתמללת...' : 'Transcribing...');
        const data = await transcribeAudioBlob(blob, lang);
        if (data?.text?.trim()) {
          const text = data.text.trim();
          setInput(text);
          send(text);
        } else {
          console.warn('Speech-to-text failed:', data?.error || 'empty transcript');
          setStatus(isHe ? 'לא הצלחתי לתמלל' : 'Could not transcribe');
          inputRef.current?.focus();
        }
      };

      recorder.start();
      recordTimerRef.current = setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, 30000);
    } catch (error) {
      console.warn('Could not access microphone:', error);
      setStatus(isHe ? 'בדקו הרשאת מיקרופון' : 'Check mic permission');
      inputRef.current?.focus();
    }
  }, [cleanupRecording, isHe, lang, send]);

  const toggleListening = useCallback(() => {
    if (busy) return;
    if (listening) {
      stopListening();
      return;
    }

    stopSpeech();
    if (isRecordedSpeechSupported()) startRecordedTranscription();
    else startBrowserRecognition();
  }, [busy, listening, stopListening, startBrowserRecognition, startRecordedTranscription]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    cleanupRecording();
  }, [cleanupRecording]);

  const toggleVoice = () => {
    setVoiceOn(v => !v);
    if (voiceOn) {
      speechRunRef.current += 1;
      stopSpeech();
      setSpeaking(false);
      setStatus(isHe ? 'מקשיב' : 'Listening');
    }
  };

  const QUICK = isHe
    ? ['היום שוב היה פיצוץ עם אורי', 'נתנו התראה מוקדמת והצליח!', 'הילד מציק לאחים']
    : ['There was another meltdown today', 'The advance warning worked!', 'Sibling issues again'];

  return (
    <div style={{
      height: '100%',
      paddingTop: 'var(--sat)',
      paddingBottom: 'var(--sab)',
      display: 'flex', flexDirection: 'column',
      direction: isHe ? 'rtl' : 'ltr',
      background: persona?.bg || '#04060d',
      overflow: 'hidden',
    }}>

      {/* ── TOP BAR ── */}
      <div style={{
        height: 48, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px',
        background: 'rgba(0,0,0,0.45)',
        borderBottom: `1px solid ${ac}20`,
        backdropFilter: 'blur(12px)',
        zIndex: 10,
      }}>
        {/* Live status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: speaking ? '#ef4444' : ac,
            boxShadow: `0 0 8px ${speaking ? '#ef4444' : ac}`,
            animation: speaking ? 'livePulse .8s ease-in-out infinite' : 'none',
          }}/>
          <span style={{ fontSize: 10, color: ac, fontWeight: 700, letterSpacing: 1.5 }}>
            {speaking ? 'SPEAKING' : 'CONNECTED'}
          </span>
        </div>

        {/* Name */}
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e8edf8' }}>
          {persona ? (isHe ? persona.name : persona.nameEn) : (isHe ? 'יועץ' : 'Advisor')}
          {persona && <span style={{ fontSize: 10, color: ac, marginRight: 6, marginLeft: 6 }}>
            {isHe ? persona.role : persona.roleEn}
          </span>}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setShowProfiles(true)} style={{
            padding: '4px 10px', borderRadius: 7,
            border: `1px solid ${profiles.length ? ac + '50' : '#252d3d'}`,
            background: profiles.length ? ac + '16' : 'rgba(0,0,0,0.3)',
            color: profiles.length ? ac : '#4a5270',
            fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
          }} title={profilesLabel}>
            {profilesLabel}{profiles.length ? ` ${profiles.length}` : ''}
          </button>
          <button onClick={toggleVoice} style={{
            padding: '4px 10px', borderRadius: 7,
            border: `1px solid ${voiceOn ? ac + '70' : '#252d3d'}`,
            background: voiceOn ? ac + '22' : 'rgba(0,0,0,0.3)',
            color: voiceOn ? ac : '#4a5270',
            fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
          }} title={isHe ? 'קול' : 'Voice'}>
            {voiceOn ? '🔊' : '🔇'}
          </button>
          <button onClick={onBack} style={{
            padding: '4px 10px', borderRadius: 7,
            border: '1px solid #252d3d', background: 'rgba(0,0,0,0.3)',
            color: '#4a5270', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {isHe ? '← החלף' : 'Switch →'}
          </button>
        </div>
      </div>

      {showProfiles && (
        <div onClick={() => setShowProfiles(false)} style={{
          position: 'fixed', inset: 0, zIndex: 40,
          background: 'rgba(0,0,0,0.62)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          padding: '72px 16px 16px',
          backdropFilter: 'blur(8px)',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 'min(720px, 100%)', maxHeight: '78vh', overflowY: 'auto',
            borderRadius: 14, border: `1px solid ${ac}35`,
            background: 'linear-gradient(180deg, rgba(13,22,38,0.98), rgba(6,10,18,0.98))',
            boxShadow: `0 24px 80px rgba(0,0,0,0.45), 0 0 30px ${glow}`,
            padding: 18,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ color: '#e8edf8', fontSize: 18, fontWeight: 800 }}>{profilesLabel}</div>
                <div style={{ color: '#66728d', fontSize: 12, marginTop: 3 }}>
                  {isHe ? '\u05d4\u05d3\u05de\u05d5\u05d9\u05d5\u05ea \u05e9\u05de\u05d0\u05d9\u05d4 \u05d6\u05d9\u05d4\u05ea\u05d4 \u05de\u05ea\u05d5\u05da \u05d4\u05e9\u05d9\u05d7\u05d4' : 'People Maya has recognized from the conversation'}
                </div>
              </div>
              <button onClick={() => setShowProfiles(false)} style={{
                width: 34, height: 34, borderRadius: 10,
                border: '1px solid #2a3348', background: 'rgba(255,255,255,0.04)',
                color: '#9aa6bd', cursor: 'pointer', fontSize: 18,
              }} aria-label={isHe ? '\u05e1\u05d2\u05d5\u05e8' : 'Close'}>x</button>
            </div>

            {profiles.length === 0 ? (
              <div style={{
                padding: '22px 16px', borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.035)',
                color: '#95a1ba', lineHeight: 1.7, fontSize: 14,
              }}>
                {isHe
                  ? '\u05e2\u05d3\u05d9\u05d9\u05df \u05d0\u05d9\u05df \u05e4\u05e8\u05d5\u05e4\u05d9\u05dc\u05d9\u05dd. \u05db\u05e9\u05ea\u05d3\u05d1\u05e8\u05d5 \u05e2\u05dc \u05d0\u05d3\u05dd \u05de\u05e1\u05d5\u05d9\u05dd, \u05de\u05d0\u05d9\u05d4 \u05ea\u05ea\u05d7\u05d9\u05dc \u05dc\u05d1\u05e0\u05d5\u05ea \u05dc\u05d5 \u05ea\u05de\u05d5\u05e0\u05d4 \u05de\u05ea\u05de\u05e9\u05db\u05ea.'
                  : 'No profiles yet. When you discuss a specific person, Maya will start building a continuing picture for them.'}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {profiles.map(profile => (
                  <div key={profile.name} style={{
                    padding: 14, borderRadius: 12,
                    border: `1px solid ${ac}22`,
                    background: 'rgba(255,255,255,0.045)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                      <div style={{ color: '#edf3ff', fontSize: 16, fontWeight: 800 }}>{profile.name}</div>
                      <div style={{ color: ac, fontSize: 12, fontWeight: 700 }}>{profile.role || (isHe ? '\u05d9\u05dc\u05d3/\u05d4' : 'child')}</div>
                    </div>
                    <ProfileField label={isHe ? '\u05d0\u05ea\u05d2\u05e8\u05d9\u05dd' : 'Challenges'} items={profile.challenges} />
                    <ProfileField label={isHe ? '\u05d8\u05e8\u05d9\u05d2\u05e8\u05d9\u05dd' : 'Triggers'} items={profile.triggers} />
                    <ProfileField label={isHe ? '\u05de\u05d4 \u05e2\u05d5\u05d1\u05d3' : 'What works'} items={profile.whatWorks} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── AVATAR CONFERENCE VIEW ── */}
      <div style={{
        flex: '0 0 auto',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-end',
        padding: '12px 0 8px',
        position: 'relative', overflow: 'hidden',
        minHeight: 320,
      }}>
        {/* Full radial glow */}
        {persona && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
            background: `radial-gradient(ellipse 80% 100% at 50% 50%, ${glow} 0%, transparent 65%)`,
            opacity: speaking ? 1 : 0.3,
            animation: speaking ? 'glowPulse 1.3s ease-in-out infinite' : 'none',
            transition: 'opacity .6s',
          }}/>
        )}

        {/* Avatar */}
        {persona ? (
          <div style={{
            position: 'relative', zIndex: 1,
            height: 300,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            animation: speaking ? 'bob .55s ease-in-out infinite' : 'idle 5s ease-in-out infinite',
          }}>
            {speaking && (
              <div style={{
                position: 'absolute', inset: -20, borderRadius: '50%',
                border: `2px solid ${ac}60`,
                animation: 'ringPulse 1s ease-in-out infinite',
                zIndex: 0,
              }}/>
            )}
            <img src={persona.img} alt={isHe ? persona.name : persona.nameEn} style={{
              height: '100%', width: 'auto', maxWidth: 280,
              objectFit: 'contain', objectPosition: 'top center',
              display: 'block', position: 'relative', zIndex: 1,
              filter: speaking
                ? `drop-shadow(0 0 30px ${persona.accent}) drop-shadow(0 0 60px ${glow})`
                : `drop-shadow(0 12px 40px rgba(0,0,0,0.8))`,
              transition: 'filter .5s',
            }}/>
          </div>
        ) : (
          <div style={{
            width: 160, height: 160, borderRadius: '50%',
            background: 'linear-gradient(135deg,#4b7cf3,#7b5cf0)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 80, position: 'relative', zIndex: 1,
            animation: speaking ? 'bob .55s ease-in-out infinite' : 'idle 5s ease-in-out infinite',
            boxShadow: speaking ? `0 0 60px ${glow}` : 'none',
            transition: 'box-shadow .4s',
          }}>🧠</div>
        )}
      </div>

      {/* ── NAME + STATUS + WAVEFORM ── */}
      <div style={{
        flexShrink: 0, textAlign: 'center', padding: '4px 20px 6px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e8edf8' }}>
            {persona ? (isHe ? persona.name : persona.nameEn) : (isHe ? 'יועץ' : 'Advisor')}
          </div>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
            color: busy ? '#f0a030' : speaking ? ac : '#4a5270',
            animation: busy || speaking ? 'statusPulse 1.5s ease-in-out infinite' : 'none',
          }}>{status}</div>
        </div>
        <Waveform active={speaking} color={ac} bars={32}/>
      </div>

      {/* Separator */}
      <div style={{
        height: 1, flexShrink: 0, margin: '0 20px',
        background: `linear-gradient(90deg, transparent, ${ac}40, transparent)`,
      }}/>

      {/* ── CHAT PANEL ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div ref={chatRef} style={{
          flex: 1, overflowY: 'auto',
          padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 7,
        }}>
          {msgs.map((m, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              animation: 'si .3s ease',
            }}>
              {m.role === 'advisor' && (
                <div style={{
                  width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                  marginLeft: isHe ? 7 : 0, marginRight: isHe ? 0 : 7,
                  marginTop: 2, overflow: 'hidden',
                  border: `1px solid ${ac}40`,
                  background: '#0a1020',
                }}>
                  {persona
                    ? <img src={persona.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}/>
                    : <span style={{ fontSize: 14, lineHeight: '26px', textAlign: 'center', display: 'block' }}>🧠</span>
                  }
                </div>
              )}
              <div style={{
                maxWidth: '76%', padding: '9px 13px',
                borderRadius: m.role === 'user'
                  ? (isHe ? '13px 13px 4px 13px' : '13px 13px 13px 4px')
                  : (isHe ? '13px 13px 13px 4px' : '13px 13px 4px 13px'),
                background: m.role === 'user' ? ac : m.isErr ? '#250808' : 'rgba(255,255,255,0.06)',
                color: m.role === 'user' ? '#fff' : '#b0bcd4',
                fontSize: 14, lineHeight: 1.7,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                border: m.role === 'advisor' && !m.isErr ? `1px solid ${ac}20` : m.isErr ? '1px solid #4a1010' : 'none',
                backdropFilter: m.role === 'advisor' ? 'blur(10px)' : 'none',
              }}>
                {m.text}
              </div>
            </div>
          ))}
          {busy && (
            <div style={{ display: 'flex', gap: 7, animation: 'si .3s ease' }}>
              <div style={{
                width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                overflow: 'hidden', background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${ac}30`,
                marginLeft: isHe ? 7 : 0, marginRight: isHe ? 0 : 7,
              }}>
                {persona ? <img src={persona.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}/> : '🧠'}
              </div>
              <div style={{
                display: 'flex', gap: 5, padding: '9px 14px',
                background: 'rgba(255,255,255,0.06)',
                borderRadius: isHe ? '13px 13px 13px 4px' : '13px 13px 4px 13px',
                alignItems: 'center', border: `1px solid ${ac}20`,
              }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: ac, animation: `bn 1.2s ${i * .17}s infinite ease-in-out` }}/>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{
          padding: '8px 12px 10px',
          borderTop: `1px solid ${ac}15`,
          background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(12px)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 7 }}>
            <input ref={inputRef} value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }}}
              placeholder={listening ? (isHe ? 'אני מקשיבה...' : 'Listening...') : (isHe ? 'ספרו מה קורה...' : 'Tell me what happened...')}
              disabled={busy || listening}
              style={{
                flex: 1, padding: '10px 14px', borderRadius: 12,
                border: `1px solid ${ac}25`, background: 'rgba(255,255,255,0.05)',
                color: '#dce0ec', fontSize: 16, fontFamily: 'inherit',
                outline: 'none', direction: isHe ? 'rtl' : 'ltr',
                opacity: busy ? 0.5 : 1, WebkitAppearance: 'none',
                backdropFilter: 'blur(8px)',
              }}
            />
            {(isSpeechInputSupported() || isRecordedSpeechSupported()) && (
              <button onClick={toggleListening} disabled={busy} style={{
                width: 42, height: 42, borderRadius: 12,
                border: `1px solid ${listening ? '#ef4444' : ac + '35'}`,
                background: listening ? '#ef444422' : 'rgba(255,255,255,0.05)',
                color: listening ? '#ef4444' : ac,
                cursor: busy ? 'default' : 'pointer',
                fontWeight: 800, fontSize: 15, fontFamily: 'inherit',
                opacity: busy ? 0.45 : 1, flexShrink: 0,
                boxShadow: listening ? '0 0 22px rgba(239,68,68,0.28)' : 'none',
              }} title={isHe ? 'דברו אל מאיה' : 'Speak to Maya'}>
                {listening ? '■' : '●'}
              </button>
            )}
            <button onClick={send} disabled={busy || !input.trim()} style={{
              padding: '10px 18px', borderRadius: 12, border: 'none',
              background: busy ? 'rgba(255,255,255,0.06)' : ac,
              color: '#fff', cursor: busy ? 'default' : 'pointer',
              fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
              opacity: busy || !input.trim() ? 0.45 : 1, flexShrink: 0,
            }}>
              {isHe ? 'שלח' : 'Send'}
            </button>
          </div>
          {!busy && (
            <div style={{ display: 'flex', gap: 5, marginTop: 7, overflowX: 'auto', paddingBottom: 1 }}>
              {QUICK.map((q, i) => (
                <button key={i} onClick={() => { setInput(q); inputRef.current?.focus(); }} style={{
                  padding: '5px 12px', borderRadius: 99,
                  border: `1px solid ${ac}20`, background: 'rgba(255,255,255,0.04)',
                  color: '#3a4460', fontSize: 11, cursor: 'pointer',
                  fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
                }}>{q}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
