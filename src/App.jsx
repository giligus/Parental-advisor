import { useState, useEffect, useRef, useCallback } from 'react';
import { THEMES } from './themes';
import { computeState, extractEvent, selectPolicy, detectCommand } from './engine';
import { buildSystemPrompt, getGreeting, getAdvisorResponse, extractProfiles, getSimFeedback, getSimIntro } from './api';
import { Gauge, ProfileCard, TypingIndicator, EmptyState } from './components';
import { SIM_SCENARIOS, QUICK_MESSAGES } from './scenarios';

const EMPTY_CASE = {
  profiles: {},
  events: [],
  insights: [],
  activeProfileId: null,
};

export default function App() {
  const [theme, setTheme] = useState('dark');
  const [lang, setLang] = useState('he');
  const [caseData, setCaseData] = useState(EMPTY_CASE);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [tab, setTab] = useState('chat');
  const [state, setState] = useState(computeState([]));
  const [typing, setTyping] = useState(false);
  const [simActive, setSimActive] = useState(false);
  const [simScen, setSimScen] = useState(null);
  const [ready, setReady] = useState(false);

  const chatRef = useRef(null);
  const inputRef = useRef(null);
  const t = THEMES[theme];
  const isHe = lang === 'he';
  const dir = isHe ? 'rtl' : 'ltr';

  // ── Init greeting ───────────────────────────────
  useEffect(() => {
    if (ready) return;
    setReady(true);
    setTyping(true);
    (async () => {
      const txt = await getGreeting(lang);
      setMsgs([{ role: 'advisor', text: txt }]);
      setTyping(false);
    })();
  }, [ready, lang]);

  // ── Auto-scroll chat ────────────────────────────
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [msgs, typing]);

  // ── Profile merge helper ────────────────────────
  const mergeProfiles = useCallback((existing, extracted) => {
    const updated = { ...existing };
    for (const p of extracted) {
      if (!p.name) continue;
      const id = p.name.toLowerCase().replace(/\s/g, '_');
      const old = updated[id] || {};
      updated[id] = {
        name: p.name,
        role: p.role || old.role || 'other',
        age: p.age || old.age,
        challenges: [...new Set([...(old.challenges || []), ...(p.challenges || [])])].slice(0, 8),
        strengths: [...new Set([...(old.strengths || []), ...(p.strengths || [])])].slice(0, 8),
        triggers: [...new Set([...(old.triggers || []), ...(p.triggers || [])])].slice(0, 8),
        whatWorks: [...new Set([...(old.whatWorks || []), ...(p.whatWorks || [])])].slice(0, 8),
        notes: p.notes || old.notes || '',
      };
    }
    return updated;
  }, []);

  // ── Send message ────────────────────────────────
  const send = useCallback(async () => {
    const m = input.trim();
    if (!m || typing) return;
    setInput('');

    // Check for settings commands
    const cmd = detectCommand(m);
    if (cmd) {
      if (cmd.type === 'theme') {
        setTheme(cmd.value);
        setMsgs(p => [...p,
          { role: 'user', text: m },
          { role: 'advisor', text: cmd.value === 'dark' ? (isHe ? 'עברתי לעיצוב כהה.' : 'Switched to dark mode.') : (isHe ? 'עברתי לעיצוב בהיר.' : 'Switched to light mode.'), isSystem: true },
        ]);
        return;
      }
      if (cmd.type === 'lang') {
        setLang(cmd.value);
        setMsgs(p => [...p,
          { role: 'user', text: m },
          { role: 'advisor', text: cmd.value === 'en' ? "Switched to English. How can I help?" : 'עברתי לעברית. איך אפשר לעזור?', isSystem: true },
        ]);
        return;
      }
    }

    const userMsg = { role: 'user', text: m };
    setMsgs(p => [...p, userMsg]);
    setTyping(true);

    // Engine pipeline (instant, local)
    const event = extractEvent(m);
    const newCase = { ...caseData, events: [...caseData.events, event] };
    setCaseData(newCase);
    const newState = computeState(newCase.events);
    setState(newState);
    const policy = selectPolicy(newState);

    // Build context
    const profileHint = Object.keys(newCase.profiles).length === 0
      ? (isHe ? '\nזו שיחה חדשה. אם המשתמש מזכיר אדם — שאל שאלות טבעיות כדי לבנות פרופיל.' : '\nNew conversation. If user mentions a person — ask natural questions to build a profile.')
      : '';
    const sys = buildSystemPrompt(lang, newCase, newState, policy, profileHint);

    // Build conversation history for LLM
    const history = [...msgs, userMsg].slice(-14).map(x => ({
      role: x.role === 'user' ? 'user' : 'assistant',
      content: x.text,
    }));

    // Parallel: get response + extract profiles
    const [reply, profiles] = await Promise.all([
      getAdvisorResponse(sys, history),
      extractProfiles([...msgs, userMsg].slice(-8)),
    ]);

    // Merge profiles
    if (profiles.length > 0) {
      setCaseData(prev => ({
        ...prev,
        profiles: mergeProfiles(prev.profiles, profiles),
      }));
    }

    setMsgs(p => [...p, { role: 'advisor', text: reply }]);
    setTyping(false);
  }, [input, caseData, msgs, typing, lang, isHe, mergeProfiles]);

  // ── Simulation ──────────────────────────────────
  const startSim = useCallback(async (s) => {
    setSimScen(s);
    setSimActive(true);
    setTab('chat');
    setTyping(true);
    const intro = await getSimIntro(lang, s);
    setMsgs(p => [...p, { role: 'advisor', text: intro, isSim: true }]);
    setTyping(false);
  }, [lang]);

  const simReply = useCallback(async (resp) => {
    if (!simScen || typing) return;
    setInput('');
    setMsgs(p => [...p, { role: 'user', text: resp }]);
    setTyping(true);
    const fb = await getSimFeedback(lang, simScen, resp);
    setMsgs(p => [...p, { role: 'advisor', text: fb, isSim: true }]);
    setTyping(false);
    setSimActive(false);
    setSimScen(null);
  }, [simScen, typing, lang]);

  // ── Tab config ──────────────────────────────────
  const tabs = isHe
    ? [{ id: 'chat', label: 'שיחה', icon: '💬' }, { id: 'profiles', label: 'פרופילים', icon: '👤' }, { id: 'status', label: 'מצב', icon: '📊' }, { id: 'sim', label: 'תרגול', icon: '🎭' }]
    : [{ id: 'chat', label: 'Chat', icon: '💬' }, { id: 'profiles', label: 'Profiles', icon: '👤' }, { id: 'status', label: 'Status', icon: '📊' }, { id: 'sim', label: 'Practice', icon: '🎭' }];

  const quickMsgs = QUICK_MESSAGES[lang] || QUICK_MESSAGES.he;
  const scenarios = SIM_SCENARIOS[lang] || SIM_SCENARIOS.he;

  // ── Render ──────────────────────────────────────
  return (
    <div style={{
      color: t.text, background: t.bg,
      height: '100%', display: 'flex', flexDirection: 'column',
      direction: dir, overflow: 'hidden',
      paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)',
      paddingLeft: 'var(--sal)', paddingRight: 'var(--sar)',
    }}>
      {/* ── HEADER ── */}
      <header style={{
        padding: '12px 16px', background: t.surface,
        borderBottom: `1px solid ${t.border}`,
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 12,
          background: `linear-gradient(135deg, ${t.accent}, ${t.purple})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, boxShadow: `0 4px 12px ${t.accentGlow}`, flexShrink: 0,
        }}>🧠</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{isHe ? 'היועץ שלכם' : 'Your Advisor'}</div>
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {typing
              ? (isHe ? 'מקליד...' : 'Typing...')
              : Object.keys(caseData.profiles).length > 0
                ? `${Object.keys(caseData.profiles).length} ${isHe ? 'פרופילים' : 'profiles'} · ${caseData.events.length} ${isHe ? 'שיחות' : 'events'}`
                : (isHe ? 'בואו נתחיל' : "Let's begin")}
          </div>
        </div>
        {state.risk !== 'low' && caseData.events.length > 0 && (
          <span style={{
            padding: '3px 10px', borderRadius: 99, fontSize: 10, fontWeight: 600, flexShrink: 0,
            background: state.risk === 'high' ? t.red + '15' : t.amber + '15',
            color: state.risk === 'high' ? t.red : t.amber,
            border: `1px solid ${state.risk === 'high' ? t.red : t.amber}30`,
          }}>
            {state.risk === 'high' ? (isHe ? 'דחוף' : 'Urgent') : (isHe ? 'לתשומת לב' : 'Attention')}
          </span>
        )}
      </header>

      {/* ── TABS ── */}
      <nav style={{
        display: 'flex', background: t.surface,
        borderBottom: `1px solid ${t.border}`, flexShrink: 0,
      }}>
        {tabs.map(x => (
          <button key={x.id} onClick={() => setTab(x.id)} style={{
            flex: 1, padding: '9px 0', background: 'transparent', border: 'none',
            borderBottom: tab === x.id ? `2px solid ${t.accent}` : '2px solid transparent',
            color: tab === x.id ? t.accent : t.textDim,
            cursor: 'pointer', fontSize: 11, fontWeight: 500, fontFamily: 'inherit',
            transition: 'all .2s',
          }}>
            <span style={{ fontSize: 14, display: 'block', marginBottom: 1 }}>{x.icon}</span>
            {x.label}
          </button>
        ))}
      </nav>

      {/* ── BODY ── */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* CHAT TAB */}
        {tab === 'chat' && <>
          <div ref={chatRef} style={{
            flex: 1, overflowY: 'auto', padding: '14px 12px',
            display: 'flex', flexDirection: 'column', gap: 8,
            WebkitOverflowScrolling: 'touch',
          }}>
            {msgs.map((m, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                animation: 'slideIn .3s ease',
              }}>
                {m.role === 'advisor' && (
                  <div style={{
                    width: 28, height: 28, borderRadius: 9, flexShrink: 0,
                    [isHe ? 'marginLeft' : 'marginRight']: 7, marginTop: 2,
                    background: m.isSystem
                      ? t.surfaceAlt
                      : m.isSim
                        ? `linear-gradient(135deg, ${t.orange}, ${t.red})`
                        : `linear-gradient(135deg, ${t.accent}, ${t.purple})`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                    border: m.isSystem ? `1px solid ${t.border}` : 'none',
                  }}>
                    {m.isSystem ? '⚙️' : m.isSim ? '🎭' : '🧠'}
                  </div>
                )}
                <div style={{
                  maxWidth: '82%', padding: m.isSystem ? '8px 14px' : '11px 15px',
                  borderRadius: m.role === 'user'
                    ? (isHe ? '16px 16px 4px 16px' : '16px 16px 16px 4px')
                    : (isHe ? '16px 16px 16px 4px' : '16px 16px 4px 16px'),
                  background: m.role === 'user' ? t.userBubble : t.advisorBubble,
                  color: m.role === 'user' ? '#fff' : m.isSystem ? t.textDim : t.textSoft,
                  fontSize: m.isSystem ? 12 : 14, lineHeight: 1.75,
                  whiteSpace: 'pre-wrap',
                  fontStyle: m.isSystem ? 'italic' : 'normal',
                  wordBreak: 'break-word',
                }}>
                  {m.text}
                </div>
              </div>
            ))}
            {typing && <TypingIndicator t={t} />}
          </div>

          {/* INPUT */}
          <div style={{
            padding: '10px 12px 12px', borderTop: `1px solid ${t.border}`,
            background: t.surface, flexShrink: 0,
          }}>
            <div style={{ display: 'flex', gap: 7 }}>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    simActive ? simReply(input) : send();
                  }
                }}
                placeholder={simActive ? (isHe ? 'מה אתם עונים?' : 'What do you say?') : (isHe ? 'ספרו מה קורה...' : 'Tell me what happened...')}
                disabled={typing}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 13,
                  border: `1px solid ${t.border}`, background: t.inputBg,
                  color: t.text, fontSize: 16, fontFamily: 'inherit',
                  outline: 'none', direction: dir, opacity: typing ? 0.5 : 1,
                  WebkitAppearance: 'none',
                }}
              />
              <button
                onClick={() => simActive ? simReply(input) : send()}
                disabled={typing || !input.trim()}
                style={{
                  padding: '10px 18px', borderRadius: 13, border: 'none',
                  background: typing ? t.surfaceAlt : simActive ? t.orange : t.accent,
                  color: '#fff', cursor: typing ? 'default' : 'pointer',
                  fontWeight: 600, fontSize: 14, fontFamily: 'inherit',
                  opacity: typing || !input.trim() ? 0.5 : 1,
                  transition: 'all .2s', flexShrink: 0,
                }}
              >
                {isHe ? 'שלח' : 'Send'}
              </button>
            </div>
            {!typing && !simActive && (
              <div style={{
                display: 'flex', gap: 5, marginTop: 8,
                overflowX: 'auto', paddingBottom: 2,
                WebkitOverflowScrolling: 'touch',
              }}>
                {quickMsgs.map((q, i) => (
                  <button key={i} onClick={() => { setInput(q); inputRef.current?.focus(); }} style={{
                    padding: '7px 13px', borderRadius: 99,
                    border: `1px solid ${t.border}`, background: t.inputBg,
                    color: t.textDim, fontSize: 12, cursor: 'pointer',
                    fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>}

        {/* PROFILES TAB */}
        {tab === 'profiles' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, WebkitOverflowScrolling: 'touch' }}>
            {Object.keys(caseData.profiles).length === 0 ? (
              <EmptyState
                icon="👤"
                title={isHe ? 'עדיין אין פרופילים' : 'No profiles yet'}
                subtitle={isHe
                  ? 'ספרו לי על מישהו בשיחה ואני אבנה פרופיל אוטומטית. למשל: ״הילד שלי בן 7, קשה לו עם מעברים״'
                  : 'Tell me about someone in our chat and I\'ll build their profile automatically.'}
                actionLabel={isHe ? 'לשיחה' : 'Go to chat'}
                onAction={() => setTab('chat')}
                t={t}
              />
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                  {isHe ? 'פרופילים' : 'Profiles'}
                </div>
                {Object.entries(caseData.profiles).map(([id, p]) => (
                  <ProfileCard key={id} profile={p} t={t} isHe={isHe} />
                ))}
                <div style={{ fontSize: 11, color: t.textDim, textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>
                  {isHe ? 'הפרופילים מתעדכנים אוטומטית מהשיחה' : 'Profiles update automatically from conversation'}
                </div>
              </>
            )}
          </div>
        )}

        {/* STATUS TAB */}
        {tab === 'status' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, WebkitOverflowScrolling: 'touch' }}>
            {caseData.events.length === 0 ? (
              <EmptyState
                icon="📊"
                title={isHe ? 'עדיין אין נתונים' : 'No data yet'}
                subtitle={isHe ? 'ספרו לי על אירועים בשיחה ותמונת המצב תתמלא' : 'Tell me about events and the status will populate'}
                actionLabel={isHe ? 'לשיחה' : 'Go to chat'}
                onAction={() => setTab('chat')}
                t={t}
              />
            ) : (
              <div style={{ background: t.surface, borderRadius: 14, padding: 18, border: `1px solid ${t.border}` }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{isHe ? 'תמונת מצב' : 'Status'}</div>
                <div style={{ fontSize: 11, color: t.textDim, marginBottom: 16 }}>
                  {caseData.events.length} {isHe ? 'אירועים' : 'events'} · {caseData.events.filter(e => e.outcome === 'improvement').length} {isHe ? 'שיפורים' : 'improvements'}
                </div>
                <Gauge label={isHe ? 'ויסות הילד' : 'Child regulation'} value={state.childReg} color={t.accent} t={t} />
                <Gauge label={isHe ? 'ויסות ההורים' : 'Parent regulation'} value={state.parentReg} color={t.purple} t={t} />
                <Gauge label={isHe ? 'התאמה בין ההורים' : 'Parental alignment'} value={state.alignment} color={t.green} t={t} />
                <Gauge label={isHe ? 'עוצמת קונפליקט' : 'Conflict intensity'} value={state.conflict} color={t.red} t={t} />
                <Gauge label={isHe ? 'אמון' : 'Trust'} value={state.trust} color={t.orange} t={t} />
                <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: t.textDim }}>{isHe ? 'רמת סיכון' : 'Risk level'}</span>
                  <span style={{
                    padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                    background: state.risk === 'high' ? t.red + '15' : state.risk === 'medium' ? t.amber + '15' : t.green + '15',
                    color: state.risk === 'high' ? t.red : state.risk === 'medium' ? t.amber : t.green,
                  }}>
                    {state.risk === 'high' ? (isHe ? 'גבוה' : 'High') : state.risk === 'medium' ? (isHe ? 'בינוני' : 'Medium') : (isHe ? 'נמוך' : 'Low')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SIMULATION TAB */}
        {tab === 'sim' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, WebkitOverflowScrolling: 'touch' }}>
            <div style={{ background: t.surface, borderRadius: 14, padding: 18, border: `1px solid ${t.border}` }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{isHe ? 'חדר תרגול' : 'Practice room'}</div>
              <p style={{ fontSize: 12, color: t.textDim, marginBottom: 16, marginTop: 4, lineHeight: 1.5 }}>
                {isHe ? 'אני אשחק את הילד. אתם תענו. אתן משוב אחרי כל תשובה.' : "I'll play the child. You respond. I'll give feedback after each answer."}
              </p>
              {scenarios.map(s => (
                <button key={s.id} onClick={() => startSim(s)} disabled={typing} style={{
                  display: 'block', width: '100%', padding: '14px 16px',
                  marginBottom: 8, background: t.surfaceAlt,
                  border: `1px solid ${t.border}`, borderRadius: 12,
                  color: t.text, cursor: typing ? 'default' : 'pointer',
                  textAlign: isHe ? 'right' : 'left', fontFamily: 'inherit',
                  opacity: typing ? 0.5 : 1, transition: 'all .15s',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{s.title}</div>
                  <div style={{ fontSize: 12, color: t.textDim }}>{s.context}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ── Dynamic scrollbar color ── */}
      <style>{`::-webkit-scrollbar-thumb { background: ${t.scrollThumb}; }`}</style>
    </div>
  );
}
