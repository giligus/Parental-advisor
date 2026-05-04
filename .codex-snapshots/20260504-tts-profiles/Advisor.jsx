import { useState, useEffect, useRef, useCallback } from 'react';
import Waveform from './Waveform';
import { callLLM, elevenLabsSpeak, webSpeechSpeak, stopSpeech, playAudioBase64, buildHistory, getSpeechRecognition, isSpeechInputSupported } from './api';
import { loadAdvisorCase, prepareAdvisorTurn, saveAdvisorCase } from './advisorBrain';

export default function Advisor({ persona, lang, onBack }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState(lang === 'he' ? 'מקשיב' : 'Listening');
  const [caseData, setCaseData] = useState(() => loadAdvisorCase());
  const chatRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);

  const isHe = lang === 'he';
  const ac = persona?.accent || '#4b9cf3';
  const glow = persona?.glow || 'rgba(75,156,243,0.4)';

  const SYS = persona
    ? (isHe
        ? `אתה ${persona.name}, יועץ התנהגותי מומחה. עברית טבעית, חמה, ישירה. 2-4 משפטים. ללא markdown.`
        : `You are ${persona.nameEn}, an expert behavioral advisor. Natural warm English. 2-4 sentences. No markdown.`)
    : (isHe
        ? 'אתה יועץ התנהגותי. עברית טבעית, חמה. 2-4 משפטים. ללא markdown.'
        : 'Expert behavioral advisor. Natural warm English. 2-4 sentences. No markdown.');

  // Speak a text response using ElevenLabs or Web Speech fallback
  const doSpeak = useCallback((text) => {
    if (!voiceOn) {
      // Animate without audio
      setSpeaking(true);
      setStatus(isHe ? 'מדבר...' : 'Speaking...');
      const dur = Math.max(1800, text.length * 55);
      setTimeout(() => { setSpeaking(false); setStatus(isHe ? 'מקשיב' : 'Listening'); inputRef.current?.focus(); }, dur);
      return;
    }

    if (persona) {
      // Try ElevenLabs first
      const voiceId = isHe ? persona.voiceIdHe : persona.voiceId;
      elevenLabsSpeak(text, voiceId).then(data => {
        if (data?.audio_base64) {
          playAudioBase64(data.audio_base64,
            () => { setSpeaking(true); setStatus(isHe ? 'מדבר...' : 'Speaking...'); },
            () => { setSpeaking(false); setStatus(isHe ? 'מקשיב' : 'Listening'); inputRef.current?.focus(); }
          );
        } else {
          console.warn('ElevenLabs unavailable, using browser speech fallback:', data?.error || 'unknown TTS error');
          setStatus(isHe ? 'קול דפדפן' : 'Browser voice');
          webSpeechSpeak(text, lang,
            () => { setSpeaking(true); setStatus(isHe ? 'מדבר...' : 'Speaking...'); },
            () => { setSpeaking(false); setStatus(isHe ? 'מקשיב' : 'Listening'); inputRef.current?.focus(); }
          );
        }
      });
    } else {
      webSpeechSpeak(text, lang,
        () => { setSpeaking(true); setStatus(isHe ? 'מדבר...' : 'Speaking...'); },
        () => { setSpeaking(false); setStatus(isHe ? 'מקשיב' : 'Listening'); inputRef.current?.focus(); }
      );
    }
  }, [voiceOn, persona, lang, isHe]);

  // Greeting
  useEffect(() => {
    setBusy(true);
    setStatus(isHe ? 'חושב...' : 'Thinking...');
    callLLM(SYS, [{ role: 'user', content: isHe ? 'שלום, פתח שיחה חמה וקצרה' : 'Hello, open with a warm brief greeting' }])
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

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setStatus(isHe ? 'מקשיב' : 'Listening');
  }, [isHe]);

  const toggleListening = useCallback(() => {
    if (busy) return;
    if (listening) {
      stopListening();
      return;
    }

    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setStatus(isHe ? 'אין תמיכה במיקרופון' : 'Mic unsupported');
      return;
    }

    stopSpeech();
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
  }, [busy, listening, stopListening, isHe, send]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
  }, []);

  const toggleVoice = () => {
    setVoiceOn(v => !v);
    if (voiceOn) stopSpeech();
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
            {isSpeechInputSupported() && (
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
