import { useState, useEffect, useRef, useCallback } from 'react';
import { THEMES } from './themes';
import { computeState, extractEvent, selectPolicy, detectCommand, routeMessage } from './engine';
import { buildSystemPrompt, getGreeting, getAdvisorResponse, getNaturalRoutedResponse, extractProfiles, getSimFeedback, getSimIntro, getWeeklyReview } from './api';
import { Gauge, ProfileCard, TypingIndicator, EmptyState } from './components';
import { SIM_SCENARIOS, QUICK_MESSAGES } from './scenarios';
import { saveCase, loadCase, clearCase, saveSession, getSessions, computeProgress, buildWeeklyReviewPrompt, shouldShowAdvisorPresence } from './session';
import { isTTSSupported, initTTS, speak, stopSpeaking, isSpeaking as checkSpeaking, isSTTSupported, startListening, stopListening } from './voice';
import AdvisorAvatar, { getExpression, AVATAR_CSS } from './AdvisorAvatar';

const EMPTY_CASE = { profiles: {}, events: [], insights: [], activeProfileId: null, activeFocus: null, pendingIntake: null };

const PERSON_NAME_SOURCE = "[\\u0590-\\u05FFA-Za-z][\\u0590-\\u05FFA-Za-z'\\-]{1,24}";

function escapeRegExp(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isNameOnly(text) {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (/^(על|about)\s+/i.test(trimmed)) return false;
  return words.length <= 2
    && trimmed.length >= 2
    && trimmed.length <= 24
    && !/[?!.]/.test(trimmed)
    && !/(היי|שלום|אהלן|רציתי|רוצה|לדבר|לשוחח|קרה|היום|אתמול|פיצוץ|מסך|בכי|צעק|ריב|בעיה|קשה|help|problem|screen|today|yesterday|want|talk|about)/i.test(trimmed);
}

function isAssumptionCorrection(text) {
  return /(לא אמרתי|לא סיפרתי|איך אתה יודע|אתה מניח|אל תניח|i did not say|i didn't say|how do you know|you assumed)/i.test(text);
}

function cleanSubjectName(value = '') {
  const cleaned = value
    .replace(/[?.!,״"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.length > 32) return null;
  if (/^(הוא|היא|אני|אנחנו|אתה|אתם|ילד|ילדה|בן|בת|הילד|הילדה|הבן|הבת|שלו|שלה|they|he|she|it)$/i.test(cleaned)) return null;
  if (/(הצק|מציק|מסך|פיצוץ|ריב|בעיה|קשה|צעק|בכה|עשה|קרה|today|problem|screen|meltdown)/i.test(cleaned)) return null;
  return cleaned;
}

function extractPersonFromPossessive(value = '') {
  const re = new RegExp(`(?:של|of|for)\\s+(${PERSON_NAME_SOURCE})`, 'iu');
  const match = value.match(re);
  return match ? cleanSubjectName(match[1]) : null;
}

function extractProfileSubject(text) {
  const trimmed = text
    .trim()
    .replace(/^(שלום|היי|הי|אהלן|hi|hello)[,\s]+/i, '')
    .trim();

  const patterns = [
    /^(?:אני\s+)?(?:רציתי|רוצה|אשמח|צריך|צריכה)\s+(?:לדבר|לשוחח)\s+על\s+(.+)$/i,
    /^(?:בואי|בוא|אפשר)?\s*(?:לדבר|לשוחח)\s+על\s+(.+)$/i,
    /^על\s+(.+)$/i,
    /^(?:about)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return extractPersonFromPossessive(match[1]) || cleanSubjectName(match[1]);
  }

  return isNameOnly(trimmed) ? cleanSubjectName(trimmed) : null;
}

function profileIntakeResponse(userText, lang) {
  const name = extractProfileSubject(userText);
  if (!name) return null;

  return lang === 'he'
    ? `בשמחה, נדבר על ${name}. מי זה ${name} מבחינתך, ומה הדבר העיקרי שחשוב לך להבין או לשנות לגביו?`
    : `Of course, let's talk about ${name}. Who is ${name} to you, and what is the main thing you want to understand or change?`;
}

function profileIdFromName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

function detectConversationConcern(text, lang) {
  const concerns = [
    {
      id: 'sibling_teasing',
      labelHe: 'הצקות בין אחים',
      labelEn: 'sibling teasing or friction',
      re: /(הצק|מציק|מציקה|אחים|אחיו|אחותו|brother|sister|sibling|teas|bother)/i,
    },
    {
      id: 'screen_boundaries',
      labelHe: 'מסכים ומעברים',
      labelEn: 'screens and transitions',
      re: /(מסך|מסכים|כיבוי|טלפון|טלוויזיה|screen|phone|tablet|tv)/i,
    },
    {
      id: 'escalation',
      labelHe: 'התפרצות או הסלמה',
      labelEn: 'escalation or meltdown',
      re: /(פיצוץ|התפרצות|צעק|צורח|בכה|בכי|ריב|meltdown|scream|yell|cry|fight)/i,
    },
    {
      id: 'homework_routine',
      labelHe: 'שיעורים ושגרה',
      labelEn: 'homework or routine',
      re: /(שיעורים|בית ספר|בוקר|שינה|homework|school|morning|bedtime|sleep)/i,
    },
  ];
  const found = concerns.find(item => item.re.test(text));
  if (!found) return null;
  return { id: found.id, label: lang === 'he' ? found.labelHe : found.labelEn };
}

function findMentionedProfileId(profiles = {}, text = '') {
  for (const [id, profile] of Object.entries(profiles || {})) {
    if (!profile?.name) continue;
    const re = new RegExp(`(^|\\s|[.,!?])${escapeRegExp(profile.name)}($|\\s|[.,!?])`, 'iu');
    if (re.test(text)) return id;
  }
  return null;
}

function createStarterProfile(name, lang, details = {}) {
  return {
    name,
    role: details.role || 'other',
    age: details.age || null,
    challenges: [],
    strengths: [],
    triggers: [],
    whatWorks: [],
    notes: details.notes || (lang === 'he'
      ? 'הפרופיל נוצר מהשיחה. חסרים עדיין גיל, קשר משפחתי ומיקוד מרכזי.'
      : 'Profile started from conversation. Age, relationship, and main focus are still missing.'),
  };
}

function normalizeExtractedProfile(profile, lang) {
  const name = cleanSubjectName(profile?.name || '');
  if (!name) return null;

  return {
    name,
    role: profile.role || 'other',
    age: profile.age || null,
    challenges: profile.challenges || [],
    strengths: profile.strengths || [],
    triggers: profile.triggers || [],
    whatWorks: profile.whatWorks || [],
    notes: profile.notes || (lang === 'he' ? 'הפרופיל נוצר מהשיחה.' : 'Profile started from conversation.'),
  };
}

function extractProfilesFromText(text, lang) {
  const results = [];
  const seen = new Set();
  const he = lang === 'he';
  const source = text.trim();

  const add = (name, details = {}) => {
    const clean = cleanSubjectName(name);
    if (!clean) return;
    const id = profileIdFromName(clean);
    if (seen.has(id)) return;
    seen.add(id);
    results.push(normalizeExtractedProfile({
      name: clean,
      role: details.role || 'other',
      age: details.age || null,
      notes: details.notes || (he ? 'הוזכר בשיחה ונוצר כפרופיל ראשוני.' : 'Mentioned in conversation and started as a profile.'),
    }, lang));
  };

  const patterns = [
    { re: /(?:בן|בת)\s+(\d{1,2})\s+(?:בשם|שקוראים לו|שקוראים לה)\s+([\p{Script=Hebrew}A-Za-z][\p{Script=Hebrew}A-Za-z'-]{1,20})/giu, role: 'child', ageFirst: true },
    { re: /(?:בשם|קוראים לו|קוראים לה|שמו|שמה)\s+([\p{Script=Hebrew}A-Za-z][\p{Script=Hebrew}A-Za-z'-]{1,20})/giu, role: 'child' },
    { re: /(?:הבן שלי|הבת שלי|הילד שלי|הילדה שלי|בני|בתי)\s+([\p{Script=Hebrew}A-Za-z][\p{Script=Hebrew}A-Za-z'-]{1,20})/giu, role: 'child' },
    { re: /([\p{Script=Hebrew}A-Za-z][\p{Script=Hebrew}A-Za-z'-]{1,20})\s+(?:בן|בת)\s+(\d{1,2})/giu, role: 'child' },
    { re: /([\p{Script=Hebrew}A-Za-z][\p{Script=Hebrew}A-Za-z'-]{1,20})\s+(?:אח שלו|אחותו|אחיו|אחותה)/giu, role: 'child' },
    { re: /([\p{Script=Hebrew}A-Za-z][\p{Script=Hebrew}A-Za-z'-]{1,20})\s+(?:מציק|מציקה|צורח|צועק|בוכה|מתפרץ|רב|מסרב|מתנגד|זורק|מרביץ|דוחף|screams|yells|cries|refuses|hits|pushes|bothers)/giu, role: 'child' },
  ];

  for (const { re, role, ageFirst } of patterns) {
    for (const match of source.matchAll(re)) {
      const age = ageFirst ? match[1] : match[2];
      const name = ageFirst ? match[2] : match[1];
      add(name, { role, age: age && /^\d+$/.test(age) ? Number(age) : null });
    }
  }

  const subject = extractProfileSubject(source);
  if (subject) add(subject, { role: 'other' });

  return results.filter(Boolean);
}

function inferProfileUpdatesFromMessage(text, lang) {
  const updates = { challenges: [], triggers: [], notes: '' };
  const he = lang === 'he';

  if (/(מציק|אחים|אח שלו|אחותו|sibling|brother|sister|bother)/i.test(text)) {
    updates.challenges.push(he ? 'קושי סביב אחים' : 'sibling friction');
    updates.triggers.push(he ? 'אינטראקציה עם אחים' : 'sibling interaction');
  }
  if (/(מסך|כיבוי|טלפון|טלוויזיה|screen|phone|tv)/i.test(text)) {
    updates.challenges.push(he ? 'קושי סביב מסכים' : 'screen-related difficulty');
    updates.triggers.push(he ? 'כיבוי מסך' : 'screen shutdown');
  }
  if (/(פיצוץ|צעק|צרח|בכי|ריב|meltdown|scream|yell|cry)/i.test(text)) {
    updates.challenges.push(he ? 'תגובות חזקות בזמן קושי' : 'strong reactions during difficulty');
  }

  return updates;
}

function mergeProfileUpdates(profile, updates) {
  return {
    ...profile,
    challenges: [...new Set([...(profile.challenges || []), ...(updates.challenges || [])])].slice(0, 8),
    triggers: [...new Set([...(profile.triggers || []), ...(updates.triggers || [])])].slice(0, 8),
    notes: profile.notes || updates.notes || '',
  };
}

function isProfileFragment(text) {
  return /(ילד|ילדה|בן|בת|אמא|אבא|הורה|תלמיד|תלמידה|child|daughter|son|parent|student)/i.test(text);
}

function isRelationalFragment(text) {
  return /(משמאל|מימין|לידי|איתי|שלי|אצלי|בצד|left|right|next to|with me)/i.test(text);
}

function naturalRouterResponse(route, lang, userText = '') {
  const he = lang === 'he';
  if (route.mode === 'continue_last_topic') {
    return he
      ? 'בשמחה. כדי שאמשיך בדיוק מהמקום הנכון, תזכיר לי במשפט אחד מה היה הנושא האחרון מבחינתך?'
      : 'Of course. To continue from the right place, remind me in one sentence what the last topic was for you?';
  }
  if (isAssumptionCorrection(userText)) {
    return he
      ? 'צודק, קפצתי צעד קדימה והנחתי שהיה אירוע לפני שסיפרת לי. תודה שתיקנת אותי. נתחיל נקי: מה תרצה שאדע או במה תרצה להתמקד?'
      : "You're right, I jumped a step ahead and assumed there was an event before you told me. Thanks for correcting me. Let's start clean: what would you like me to know or focus on?";
  }
  if (route.mode === 'fragment_intake') {
    if (isRelationalFragment(userText)) {
      return he
        ? 'הבנתי. אני צריך עוד טיפת הקשר כדי לא לנחש: מי זה, ומה חשוב לי להבין לגביו?'
        : 'Got it. I need a little more context so I do not guess: who is this, and what should I understand about them?';
    }
    if (isProfileFragment(userText)) {
      return he
        ? 'הבנתי, מדובר בילד או בפרופיל שחשוב שנכיר. תספרו לי במשפט אחד: בן כמה הוא ומה הדבר המרכזי שהייתם רוצים להבין או לשנות?'
        : 'Got it, this is about a child or profile we should understand. Tell me in one sentence: how old are they, and what is the main thing you want to understand or change?';
    }
    if (isNameOnly(userText)) {
      return he
        ? `נעים להכיר, ${userText.trim()}. אני כאן איתך. במה תרצה שנתמקד היום?`
        : `Nice to meet you, ${userText.trim()}. I'm here with you. What would you like to focus on today?`;
    }
    return he
      ? 'הבנתי. תנו לי עוד משפט אחד כדי שאדע לאן לקחת את זה: על מי מדובר ומה הדבר שחשוב לכם להבין?'
      : 'Got it. Give me one more sentence so I know where to take this: who is this about, and what matters most to understand?';
  }
  if (route.mode === 'clarifying' && isNameOnly(userText)) {
    return he
      ? `נעים להכיר, ${userText.trim()}. אני כאן איתך. במה תרצה שנתמקד היום?`
      : `Nice to meet you, ${userText.trim()}. I'm here with you. What would you like to focus on today?`;
  }
  if (route.mode === 'greeting') {
    return he
      ? 'שלום, טוב שחזרתם. תרצו לספר מה מעסיק אתכם היום, או להמשיך מהנושא האחרון?'
      : 'Hi, good to see you back. Would you like to tell me what is on your mind today, or continue from the last topic?';
  }
  if (route.mode === 'clarifying') {
    return he
      ? 'אני איתך. ספרו לי קצת מה מעסיק אתכם, ומשם נבין יחד מה נכון לעשות.'
      : "I'm with you. Tell me a little about what's on your mind, and we will work it through from there.";
  }
  if (route.mode === 'event_intake') {
    return he
      ? 'אוקיי, זה נשמע כמו אירוע שכדאי להבין לפני שמנתחים. מה קרה בפועל, ומה אתם אמרתם או עשיתם באותו רגע?'
      : 'Okay, this sounds like something worth understanding before analyzing. What happened in practice, and what did you say or do at that moment?';
  }
  const responses = {
    greeting: he
      ? 'שלום, טוב שחזרתם. תרצו לספר מה קרה היום, או להמשיך מהנושא האחרון?'
      : 'Hi, good to see you back. Would you like to tell me what happened today, or continue from the last topic?',
    clarifying: he
      ? 'אני איתך. ספרו לי קצת מה מעסיק אתכם, ומשם נבין יחד מה נכון לעשות.'
      : "I'm with you. Tell me a little about what's on your mind, and we will work it through from there.",
    empathic: he
      ? 'זה נשמע ממש שוחק. לפני שננסה לפתור, בואו נעשה רגע סדר: מה קרה ממש לפני שהרגשתם שזה יוצא משליטה?'
      : 'That sounds really draining. Before trying to fix it, let us map it gently: what happened right before it felt out of control?',
    event_intake: he
      ? 'אוקיי, זה נשמע כמו אירוע שכדאי להבין לפני שמנתחים. מה קרה בפועל, ומה אתם אמרתם או עשיתם באותו רגע?'
      : 'Okay, this sounds like something worth understanding before analyzing. What happened in practice, and what did you say or do at that moment?',
    action_plan: he
      ? 'כן. כרגע הייתי נשאר עם תוכנית פשוטה: התראה קצרה לפני המעבר, בחירה מוגבלת, משפט גבול קצר בזמן ההתנגדות, ושיחת תיקון רק אחרי רגיעה.'
      : 'Yes. I would keep the plan simple: a short warning before the transition, a limited choice, one short boundary sentence during resistance, and repair only after things settle.',
    simulation: he
      ? 'מעולה, נעבור לתרגול. בחרו סיטואציה בחדר התרגול, ואני אשחק את הילד ואתן משוב אחרי התגובה שלכם.'
      : "Great, let's practice. Choose a situation in the practice room, and I will play the child and give feedback after your response.",
  };
  return responses[route.mode] || responses.clarifying;
}

function safetyResponse(lang) {
  return lang === 'he'
    ? 'קודם כל בטיחות. אם יש סכנה מיידית לעצמכם, לילד, או למישהו בבית, עוצרים את הייעוץ הרגיל ופונים עכשיו לעזרה מקומית מתאימה או לשירותי חירום. אחרי שכולם בטוחים, אפשר לחזור ולחשוב יחד מה קרה.'
    : 'Safety comes first. If there is immediate danger to you, the child, or anyone at home, pause the normal advice and contact local emergency or professional support now. Once everyone is safe, we can come back and understand what happened.';
}

function buildConversationHistory(messages) {
  const clean = [];

  for (const message of messages) {
    if (!message || message.isSystem || message.isError || !message.text) continue;

    const role = message.role === 'user' ? 'user' : 'assistant';
    const content = String(message.text).trim();
    if (!content) continue;

    const previous = clean[clean.length - 1];
    if (previous?.role === role) {
      previous.content = `${previous.content}\n\n${content}`;
    } else {
      clean.push({ role, content });
    }
  }

  while (clean.length > 0 && clean[0].role !== 'user') clean.shift();
  return clean.slice(-12);
}

function createAdvisorInsight({ type, title, summary, supportingEventId, progress, routeMode }) {
  return {
    id: `insight_${Date.now()}`,
    createdAt: new Date().toISOString(),
    type,
    title,
    summary,
    routeMode,
    supportingEvents: supportingEventId ? [supportingEventId] : [],
    progressDirection: progress?.direction || null,
  };
}

export default function App() {
  const [theme, setTheme] = useState('dark');
  const [lang, setLang] = useState('he');
  const [caseData, setCaseData] = useState(() => loadCase() || EMPTY_CASE);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [tab, setTab] = useState('chat');
  const [state, setState] = useState(() => computeState(caseData.events || []));
  const [typing, setTyping] = useState(false);
  const [simActive, setSimActive] = useState(false);
  const [simScen, setSimScen] = useState(null);
  const [ready, setReady] = useState(false);
  // Phase 2
  const [lastPolicy, setLastPolicy] = useState(null);
  const [lastEventOutcome, setLastEventOutcome] = useState(null);
  // Phase 3
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListeningState] = useState(false);
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [sttAvailable] = useState(isSTTSupported());
  // Phase 4
  const [avatarExpression, setAvatarExpression] = useState('neutral');

  const chatRef = useRef(null);
  const inputRef = useRef(null);
  const t = THEMES[theme];
  const isHe = lang === 'he';
  const dir = isHe ? 'rtl' : 'ltr';

  // ── Persist case data ─────────────────────────────
  useEffect(() => { saveCase(caseData); }, [caseData]);

  // ── Init TTS ──────────────────────────────────────
  useEffect(() => { initTTS().then(ok => setTtsAvailable(ok)); }, []);

  // ── Update avatar expression ──────────────────────
  useEffect(() => {
    setAvatarExpression(getExpression(lastPolicy, typing, speaking, lastEventOutcome));
  }, [lastPolicy, typing, speaking, lastEventOutcome]);

  // ── Init greeting ─────────────────────────────────
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

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [msgs, typing]);

  // ── Voice: speak advisor response ─────────────────
  const speakText = useCallback((text) => {
    if (!voiceEnabled || !ttsAvailable) return;
    speak(text, lang, () => setSpeaking(true), () => setSpeaking(false));
  }, [voiceEnabled, ttsAvailable, lang]);

  // ── Voice: toggle mic ─────────────────────────────
  const toggleMic = useCallback(() => {
    if (listening) {
      stopListening();
      setListeningState(false);
    } else {
      setListeningState(true);
      startListening(
        lang,
        (transcript, isFinal) => { setInput(transcript); },
        (finalText) => { setListeningState(false); if (finalText) { setInput(finalText); } },
        () => { setListeningState(false); }
      );
    }
  }, [listening, lang]);

  // ── Profile merge ─────────────────────────────────
  const mergeProfiles = useCallback((existing, extracted) => {
    const updated = { ...existing };
    for (const p of extracted) {
      if (!p.name) continue;
      const id = p.name.toLowerCase().replace(/\s/g, '_');
      const old = updated[id] || {};
      updated[id] = {
        name: p.name, role: p.role || old.role || 'other', age: p.age || old.age,
        challenges: [...new Set([...(old.challenges || []), ...(p.challenges || [])])].slice(0, 8),
        strengths: [...new Set([...(old.strengths || []), ...(p.strengths || [])])].slice(0, 8),
        triggers: [...new Set([...(old.triggers || []), ...(p.triggers || [])])].slice(0, 8),
        whatWorks: [...new Set([...(old.whatWorks || []), ...(p.whatWorks || [])])].slice(0, 8),
        notes: p.notes || old.notes || '',
      };
    }
    return updated;
  }, []);

  // ── Send message ──────────────────────────────────
  const sendText = useCallback(async (rawText) => {
    const m = rawText.trim();
    if (!m || typing) return;
    setInput('');
    stopSpeaking();

    // Settings commands
    const cmd = detectCommand(m);
    if (cmd) {
      if (cmd.type === 'theme') {
        setTheme(cmd.value);
        setMsgs(p => [...p, { role: 'user', text: m }, { role: 'advisor', text: cmd.value === 'dark' ? (isHe ? 'עברתי לעיצוב כהה.' : 'Switched to dark mode.') : (isHe ? 'עברתי לעיצוב בהיר.' : 'Switched to light mode.'), isSystem: true }]);
        return;
      }
      if (cmd.type === 'lang') {
        setLang(cmd.value);
        setMsgs(p => [...p, { role: 'user', text: m }, { role: 'advisor', text: cmd.value === 'en' ? "Switched to English." : 'עברתי לעברית.', isSystem: true }]);
        return;
      }
    }

    const route = routeMessage(m);

    if (!route.synthesis) {
      const userMsg = { role: 'user', text: m };
      const contextualProfiles = extractProfilesFromText(m, lang);
      const profileSubject = extractProfileSubject(m) || contextualProfiles[0]?.name || null;
      const concern = detectConversationConcern(m, lang);
      const mentionedProfileId = findMentionedProfileId(caseData.profiles || {}, m);
      let nextCaseData = caseData;
      let nextProfiles = caseData.profiles || {};
      let nextActiveProfileId = mentionedProfileId || caseData.activeProfileId || null;
      let caseChanged = false;

      const profilesToMerge = [...contextualProfiles];
      if (profileSubject && !profilesToMerge.some(profile => profile?.name === profileSubject)) {
        profilesToMerge.push(createStarterProfile(profileSubject, lang));
      }

      if (profilesToMerge.length > 0) {
        nextProfiles = mergeProfiles(nextProfiles, profilesToMerge);
        nextActiveProfileId = mentionedProfileId || profileIdFromName(profileSubject || profilesToMerge[0].name);
        nextCaseData = { ...nextCaseData, profiles: nextProfiles, activeProfileId: nextActiveProfileId };
        caseChanged = true;
      } else if (mentionedProfileId && mentionedProfileId !== caseData.activeProfileId) {
        nextActiveProfileId = mentionedProfileId;
        nextCaseData = { ...nextCaseData, activeProfileId: nextActiveProfileId };
        caseChanged = true;
      }

      if (nextActiveProfileId && nextProfiles[nextActiveProfileId] && concern) {
        nextProfiles = {
          ...nextProfiles,
          [nextActiveProfileId]: mergeProfileUpdates(
            nextProfiles[nextActiveProfileId],
            inferProfileUpdatesFromMessage(m, lang)
          ),
        };
        nextCaseData = { ...nextCaseData, profiles: nextProfiles };
        caseChanged = true;
      }

      if (concern || profileSubject) {
        nextCaseData = {
          ...nextCaseData,
          activeFocus: {
            id: concern?.id || 'profile_understanding',
            label: concern?.label || profileSubject,
            profileId: nextActiveProfileId,
            sourceText: m,
            updatedAt: new Date().toISOString(),
          },
        };
        caseChanged = true;
      }
      if (route.mode === 'simulation') setTab('sim');
      if (route.mode === 'event_intake') {
        nextCaseData = {
          ...nextCaseData,
          pendingIntake: {
            text: m,
            missing: route.context.missing,
            profileId: nextActiveProfileId,
            focus: nextCaseData.activeFocus || null,
            date: new Date().toISOString(),
          },
        };
        caseChanged = true;
      }
      if (caseChanged) setCaseData(nextCaseData);
      setMsgs(p => [...p, userMsg]);
      setTyping(true);
      const history = buildConversationHistory([...msgs, userMsg]);
      const modelResponse = route.mode === 'simulation'
        ? null
        : await getNaturalRoutedResponse({ lang, route, caseData: nextCaseData, conversationHistory: history, userText: m });
      const response = modelResponse || naturalRouterResponse(route, lang, m);
      setMsgs(p => [...p, { role: 'advisor', text: response }]);
      setTyping(false);
      saveSession({ routeMode: route.mode, userMessage: m, advisorMessage: response, eventCreated: false });
      speakText(response);

      if (contextualProfiles.length === 0 && !['greeting', 'simulation', 'continue_last_topic', 'correction'].includes(route.mode)) {
        const profiles = await extractProfiles([...msgs, userMsg, { role: 'advisor', text: response }].slice(-6));
        if (profiles.length > 0) {
          setCaseData(prev => {
            const merged = mergeProfiles(prev.profiles || {}, profiles);
            const firstId = profiles[0]?.name ? profileIdFromName(profiles[0].name) : prev.activeProfileId;
            return {
              ...prev,
              profiles: merged,
              activeProfileId: prev.activeProfileId || firstId,
            };
          });
        }
      }
      return;
    }

    if (route.mode === 'safety') {
      const response = safetyResponse(lang);
      setMsgs(p => [...p, { role: 'user', text: m }, { role: 'advisor', text: response, isInsight: true }]);
      saveSession({ routeMode: route.mode, userMessage: m, advisorMessage: response, eventCreated: false, safety: true });
      speakText(response);
      return;
    }

    // Weekly review / big-picture request
    if (route.mode === 'weekly_review' || route.mode === 'big_picture') {
      setMsgs(p => [...p, { role: 'user', text: m }]);
      setTyping(true);
      const progress = computeProgress(caseData.events);
      const reviewPrompt = buildWeeklyReviewPrompt(lang, caseData, state, progress);
      const review = await getWeeklyReview(reviewPrompt);
      const reviewInsight = createAdvisorInsight({
        type: route.mode,
        title: route.mode === 'weekly_review' ? 'Weekly review' : 'Big picture synthesis',
        summary: review,
        progress,
        routeMode: route.mode,
      });
      setCaseData(prev => ({ ...prev, insights: [...(prev.insights || []), reviewInsight] }));
      setMsgs(p => [...p, { role: 'advisor', text: review, isInsight: true }]);
      setTyping(false);
      saveSession({ routeMode: route.mode, userMessage: m, advisorMessage: review, eventCreated: false, insightId: reviewInsight.id });
      speakText(review);
      return;
    }

    const userMsg = { role: 'user', text: m };
    setMsgs(p => [...p, userMsg]);
    setTyping(true);

    // Engine pipeline only runs when the router says the event has enough context.
    const event = extractEvent(m);
    const newCase = { ...caseData, events: [...caseData.events, event] };
    setCaseData(newCase);
    const newState = computeState(newCase.events);
    setState(newState);
    const policy = selectPolicy(newState);
    setLastPolicy(policy);
    setLastEventOutcome(event.outcome);

    // Build context
    const profileHint = Object.keys(newCase.profiles).length === 0
      ? (isHe ? '\nזו שיחה חדשה. אם המשתמש מזכיר אדם — שאל שאלות טבעיות כדי לבנות פרופיל.' : '\nNew conversation. If user mentions a person — ask natural questions.')
      : '';
    
    // Phase 2: Add progress context
    const progress = computeProgress(newCase.events);
    const progressHint = progress ? `\n${isHe ? 'מגמה' : 'Trend'}: ${progress.direction}` : '';
    const eventHint = `\n\nCurrent event to answer directly:
- Raw report: "${event.raw}"
- Type: ${event.type}
- Trigger: ${event.trigger || 'unknown'}
- Outcome: ${event.outcome}

Answer this current event specifically. Do not ask a generic "what is on your mind" question after an event was reported.`;
    
    const sys = buildSystemPrompt(lang, newCase, newState, policy, profileHint + progressHint + eventHint);
    const history = buildConversationHistory([...msgs, userMsg]);
    const reply = await getAdvisorResponse(sys, history);

    // Phase 2: Check for advisor presence moment
    const presenceReason = shouldShowAdvisorPresence(newCase, newState, event);
    const advisorInsight = createAdvisorInsight({
      type: presenceReason ? 'advisor_moment' : 'message_synthesis',
      title: presenceReason || 'Advisor response',
      summary: reply,
      supportingEventId: event.id,
      progress,
      routeMode: route.mode,
    });
    
    setMsgs(p => [...p, { role: 'advisor', text: reply, presenceReason }]);
    setTyping(false);
    speakText(reply);
    saveSession({ routeMode: route.mode, userMessage: m, advisorMessage: reply, eventCreated: true, eventId: event.id, insightId: advisorInsight.id });

    const deterministicProfiles = extractProfilesFromText(m, lang);
    const llmProfiles = await extractProfiles([...msgs, userMsg, { role: 'advisor', text: reply }].slice(-6));
    const profiles = [...deterministicProfiles, ...llmProfiles];
    setCaseData(prev => ({
      ...prev,
      profiles: profiles.length > 0 ? mergeProfiles(prev.profiles, profiles) : prev.profiles,
      activeProfileId: prev.activeProfileId || (profiles[0]?.name ? profileIdFromName(profiles[0].name) : prev.activeProfileId),
      insights: [...(prev.insights || []), advisorInsight],
    }));
  }, [caseData, msgs, typing, lang, isHe, mergeProfiles, state, speakText]);

  const send = useCallback(() => sendText(input), [input, sendText]);

  // ── Simulation ────────────────────────────────────
  const startSim = useCallback(async (s) => {
    setSimScen(s); setSimActive(true); setTab('chat'); setTyping(true);
    const intro = await getSimIntro(lang, s);
    setMsgs(p => [...p, { role: 'advisor', text: intro, isSim: true }]);
    setTyping(false);
    speakText(intro);
  }, [lang, speakText]);

  const simReply = useCallback(async (resp) => {
    if (!simScen || typing) return;
    setInput('');
    setMsgs(p => [...p, { role: 'user', text: resp }]);
    setTyping(true);
    const fb = await getSimFeedback(lang, simScen, resp);
    setMsgs(p => [...p, { role: 'advisor', text: fb, isSim: true }]);
    setTyping(false); setSimActive(false); setSimScen(null);
    speakText(fb);
  }, [simScen, typing, lang, speakText]);

  const exportMemory = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      caseData,
      sessions: getSessions(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `advisor-memory-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [caseData]);

  const clearMemory = useCallback(() => {
    const message = isHe
      ? 'למחוק את זיכרון התיק מהמכשיר הזה? פעולה זו תמחק פרופילים, אירועים ותובנות שנשמרו מקומית.'
      : 'Clear advisor memory from this device? This removes locally saved profiles, events, and insights.';
    if (!window.confirm(message)) return;
    clearCase();
    setCaseData(EMPTY_CASE);
    setState(computeState([]));
    setLastPolicy(null);
    setLastEventOutcome(null);
    setMsgs([{ role: 'advisor', text: isHe ? 'הזיכרון המקומי נמחק. אפשר להתחיל מחדש.' : 'Local memory was cleared. We can start fresh.' }]);
    setTab('chat');
  }, [isHe]);

  const resetSessionView = useCallback(() => {
    stopSpeaking();
    setInput('');
    setTyping(false);
    setSimActive(false);
    setSimScen(null);
    setMsgs([{ role: 'advisor', text: isHe ? 'איפסתי את השיחה שעל המסך. הזיכרון המקומי נשאר שמור.' : 'I reset the visible chat. Local memory is still saved.' }]);
    setTab('chat');
  }, [isHe]);

  // ── Tabs ──────────────────────────────────────────
  const tabs = isHe
    ? [{ id: 'chat', label: 'שיחה', icon: '💬' }, { id: 'profiles', label: 'פרופילים', icon: '👤' }, { id: 'status', label: 'מצב', icon: '📊' }, { id: 'sim', label: 'תרגול', icon: '🎭' }]
    : [{ id: 'chat', label: 'Chat', icon: '💬' }, { id: 'profiles', label: 'Profiles', icon: '👤' }, { id: 'status', label: 'Status', icon: '📊' }, { id: 'sim', label: 'Practice', icon: '🎭' }];

  const quickMsgs = QUICK_MESSAGES[lang] || QUICK_MESSAGES.he;
  const scenarios = SIM_SCENARIOS[lang] || SIM_SCENARIOS.he;
  const progress = computeProgress(caseData.events);
  const advisorStageStatus = typing
    ? (isHe ? 'חושבת...' : 'Thinking...')
    : speaking
      ? (isHe ? 'מדברת...' : 'Speaking...')
      : listening
        ? (isHe ? 'מקשיבה...' : 'Listening...')
        : simActive
          ? (isHe ? 'בתרגול' : 'Practice')
          : (isHe ? 'כאן איתכם' : 'Here with you');

  return (
    <div style={{ color: t.text, background: t.bg, height: '100%', display: 'flex', flexDirection: 'column', direction: dir, overflow: 'hidden', paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)', paddingLeft: 'var(--sal)', paddingRight: 'var(--sar)' }}>
      <style>{AVATAR_CSS}</style>

      {/* ── HEADER ── */}
      <header style={{ padding: '10px 16px', background: t.surface, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{isHe ? 'היועץ שלכם' : 'Your Advisor'}</div>
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {typing ? (isHe ? 'חושב...' : 'Thinking...') : speaking ? (isHe ? 'מדבר...' : 'Speaking...') : listening ? (isHe ? 'מקשיב...' : 'Listening...') : Object.keys(caseData.profiles).length > 0 ? `${Object.keys(caseData.profiles).length} ${isHe ? 'פרופילים' : 'profiles'} · ${caseData.events.length} ${isHe ? 'אירועים' : 'events'}` : (isHe ? 'בואו נתחיל' : "Let's begin")}
          </div>
        </div>
        {/* Voice controls */}
        <div style={{ display: 'flex', gap: 4 }}>
          {ttsAvailable && (
            <button onClick={() => { setVoiceEnabled(v => !v); if (voiceEnabled) stopSpeaking(); }} style={{ width: 32, height: 32, borderRadius: 10, border: `1px solid ${t.border}`, background: voiceEnabled ? t.accent + '20' : 'transparent', color: voiceEnabled ? t.accent : t.textDim, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', transition: 'all .2s' }} title={isHe ? 'קול' : 'Voice'}>
              {voiceEnabled ? '🔊' : '🔇'}
            </button>
          )}
          {state.risk !== 'low' && caseData.events.length > 0 && (
            <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 10, fontWeight: 600, flexShrink: 0, background: state.risk === 'high' ? t.red + '15' : t.amber + '15', color: state.risk === 'high' ? t.red : t.amber, border: `1px solid ${state.risk === 'high' ? t.red : t.amber}30`, alignSelf: 'center' }}>
              {state.risk === 'high' ? (isHe ? 'דחוף' : 'Urgent') : (isHe ? 'לתשומת לב' : 'Attention')}
            </span>
          )}
        </div>
      </header>

      {/* ── TABS ── */}
      <nav style={{ display: 'flex', background: t.surface, borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        {tabs.map(x => (
          <button key={x.id} onClick={() => setTab(x.id)} style={{ flex: 1, padding: '9px 0', background: 'transparent', border: 'none', borderBottom: tab === x.id ? `2px solid ${t.accent}` : '2px solid transparent', color: tab === x.id ? t.accent : t.textDim, cursor: 'pointer', fontSize: 11, fontWeight: 500, fontFamily: 'inherit', transition: 'all .2s' }}>
            <span style={{ fontSize: 14, display: 'block', marginBottom: 1 }}>{x.icon}</span>{x.label}
          </button>
        ))}
      </nav>

      {/* ── BODY ── */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* CHAT */}
        {tab === 'chat' && <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <section style={{
            flexShrink: 0,
            minHeight: 270,
            padding: '18px 16px 14px',
            borderBottom: `1px solid ${t.border}`,
            background: `radial-gradient(circle at 50% 40%, ${t.accent}18 0%, transparent 42%), ${t.bg}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{ width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <AdvisorAvatar
                expression={avatarExpression}
                isSpeaking={speaking}
                size={220}
                theme={t}
                style={{ margin: '0 auto' }}
              />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, flexWrap: 'wrap' }}>
                <div aria-live="polite" style={{
                  minWidth: 92,
                  textAlign: 'center',
                  padding: '6px 12px',
                  borderRadius: 999,
                  background: t.surface,
                  border: `1px solid ${t.border}`,
                  color: t.textSoft,
                  fontSize: 12,
                  fontWeight: 600,
                }}>
                  {advisorStageStatus}
                </div>

                {ttsAvailable && (
                  <button onClick={() => { setVoiceEnabled(v => !v); if (voiceEnabled) stopSpeaking(); }} style={{
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    border: `1px solid ${voiceEnabled ? t.accent + '70' : t.border}`,
                    background: voiceEnabled ? t.accent + '18' : t.surface,
                    color: voiceEnabled ? t.accent : t.textDim,
                    cursor: 'pointer',
                    fontSize: 15,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'inherit',
                    transition: 'all .2s',
                  }} title={isHe ? 'קול' : 'Voice'}>
                    {voiceEnabled ? '🔊' : '🔇'}
                  </button>
                )}

                {sttAvailable && (
                  <button onClick={toggleMic} disabled={typing} style={{
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    border: listening ? `2px solid ${t.red}` : `1px solid ${t.border}`,
                    background: listening ? t.red + '15' : t.surface,
                    color: listening ? t.red : t.textDim,
                    cursor: typing ? 'default' : 'pointer',
                    fontSize: 15,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'inherit',
                    transition: 'all .2s',
                    animation: listening ? 'micPulse 1.5s ease-in-out infinite' : 'none',
                    opacity: typing ? 0.45 : 1,
                  }} title={isHe ? 'מיקרופון' : 'Microphone'}>
                    🎤
                  </button>
                )}
              </div>
            </div>
          </section>

          <div ref={chatRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, WebkitOverflowScrolling: 'touch' }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', animation: 'slideIn .3s ease' }}>
                <div style={{
                  maxWidth: m.role === 'user' ? '74%' : 'min(760px, 86%)', padding: m.isSystem ? '8px 14px' : '11px 15px',
                  borderRadius: m.role === 'user' ? (isHe ? '16px 16px 4px 16px' : '16px 16px 16px 4px') : (isHe ? '16px 16px 16px 4px' : '16px 16px 4px 16px'),
                  background: m.role === 'user' ? t.userBubble : m.isInsight ? t.accent + '12' : t.advisorBubble,
                  color: m.role === 'user' ? '#fff' : m.isSystem ? t.textDim : t.textSoft,
                  fontSize: m.isSystem ? 12 : 14, lineHeight: 1.75, whiteSpace: 'pre-wrap',
                  fontStyle: m.isSystem ? 'italic' : 'normal', wordBreak: 'break-word',
                  border: m.isInsight ? `1px solid ${t.accent}25` : 'none',
                }}>
                  {m.presenceReason && (
                    <div style={{ fontSize: 10, color: t.accent, fontWeight: 600, marginBottom: 4, letterSpacing: 0.5 }}>
                      {m.presenceReason === 'weekly_review' ? (isHe ? '📊 סיכום שבועי' : '📊 Weekly review') : m.presenceReason === 'progress_celebration' ? (isHe ? '🎉 התקדמות' : '🎉 Progress') : m.presenceReason === 'pattern_alert' ? (isHe ? '⚠️ שימו לב' : '⚠️ Attention') : m.presenceReason === 'new_pattern' ? (isHe ? '🔍 תובנה חדשה' : '🔍 New insight') : ''}
                    </div>
                  )}
                  {m.text}
                </div>
              </div>
            ))}
            {typing && <TypingIndicator t={t} />}
          </div>

          {/* INPUT with mic button */}
          <div style={{ padding: '10px 12px 12px', borderTop: `1px solid ${t.border}`, background: t.surface, flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              {sttAvailable && (
                <button onClick={toggleMic} disabled={typing} style={{
                  width: 38, height: 38, borderRadius: 12, border: listening ? `2px solid ${t.red}` : `1px solid ${t.border}`,
                  background: listening ? t.red + '15' : 'transparent',
                  color: listening ? t.red : t.textDim, cursor: typing ? 'default' : 'pointer',
                  fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'inherit', transition: 'all .2s', flexShrink: 0,
                  animation: listening ? 'micPulse 1.5s ease-in-out infinite' : 'none',
                  opacity: typing ? 0.4 : 1,
                }}>🎤</button>
              )}
              <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); simActive ? simReply(input) : send(); } }}
                placeholder={listening ? (isHe ? 'מדברים...' : 'Speaking...') : simActive ? (isHe ? 'מה אתם עונים?' : 'What do you say?') : (isHe ? 'ספרו מה קורה...' : 'Tell me what happened...')}
                disabled={typing}
                style={{ flex: 1, padding: '10px 14px', borderRadius: 13, border: `1px solid ${t.border}`, background: listening ? t.red + '08' : t.inputBg, color: t.text, fontSize: 16, fontFamily: 'inherit', outline: 'none', direction: dir, opacity: typing ? 0.5 : 1, WebkitAppearance: 'none', transition: 'background .3s' }}
              />
              <button onClick={() => simActive ? simReply(input) : send()} disabled={typing || !input.trim()}
                style={{ padding: '10px 18px', borderRadius: 13, border: 'none', background: typing ? t.surfaceAlt : simActive ? t.orange : t.accent, color: '#fff', cursor: typing ? 'default' : 'pointer', fontWeight: 600, fontSize: 14, fontFamily: 'inherit', opacity: typing || !input.trim() ? 0.5 : 1, transition: 'all .2s', flexShrink: 0 }}>
                {isHe ? 'שלח' : 'Send'}
              </button>
            </div>
            {!typing && !simActive && (
              <div style={{ display: 'flex', gap: 5, marginTop: 8, overflowX: 'auto', paddingBottom: 2, WebkitOverflowScrolling: 'touch' }}>
                {[...quickMsgs, isHe ? 'תן לי תמונה כוללת' : 'Give me the big picture'].map((q, i) => (
                  <button key={i} onClick={() => { setInput(q); inputRef.current?.focus(); }} style={{ padding: '7px 13px', borderRadius: 99, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textDim, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>{q}</button>
                ))}
              </div>
            )}
          </div>
        </div>}

        {/* PROFILES */}
        {tab === 'profiles' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, WebkitOverflowScrolling: 'touch' }}>
            {Object.keys(caseData.profiles).length === 0 ? (
              <EmptyState icon="👤" title={isHe ? 'עדיין אין פרופילים' : 'No profiles yet'} subtitle={isHe ? 'ספרו לי על מישהו בשיחה ואני אבנה פרופיל אוטומטית.' : "Tell me about someone in chat and I'll build their profile."} actionLabel={isHe ? 'לשיחה' : 'Go to chat'} onAction={() => setTab('chat')} t={t} />
            ) : <>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{isHe ? 'פרופילים' : 'Profiles'}</div>
              {Object.entries(caseData.profiles).map(([id, p]) => <ProfileCard key={id} profile={p} t={t} isHe={isHe} />)}
              <div style={{ fontSize: 11, color: t.textDim, textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>{isHe ? 'הפרופילים מתעדכנים אוטומטית מהשיחה' : 'Profiles update automatically'}</div>
            </>}
          </div>
        )}

        {/* STATUS — Enhanced with progress tracking */}
        {tab === 'status' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, WebkitOverflowScrolling: 'touch' }}>
            {caseData.events.length === 0 ? (
              <EmptyState icon="📊" title={isHe ? 'עדיין אין נתונים' : 'No data yet'} subtitle={isHe ? 'ספרו לי על אירועים ותמונת המצב תתמלא' : 'Tell me about events and the status will populate'} actionLabel={isHe ? 'לשיחה' : 'Go to chat'} onAction={() => setTab('chat')} t={t} />
            ) : <>
              {/* Progress banner */}
              {progress && (
                <div style={{ background: progress.direction === 'improving' ? t.green + '12' : progress.direction === 'declining' ? t.red + '12' : t.surfaceAlt, borderRadius: 14, padding: '14px 16px', marginBottom: 12, border: `1px solid ${progress.direction === 'improving' ? t.green + '30' : progress.direction === 'declining' ? t.red + '30' : t.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <AdvisorAvatar expression={progress.direction === 'improving' ? 'happy' : progress.direction === 'declining' ? 'concerned' : 'neutral'} size={36} showGlow={false} theme={t} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: progress.direction === 'improving' ? t.green : progress.direction === 'declining' ? t.red : t.textSoft }}>
                      {progress.direction === 'improving' ? (isHe ? 'מגמת שיפור' : 'Improving') : progress.direction === 'declining' ? (isHe ? 'דורש תשומת לב' : 'Needs attention') : (isHe ? 'יציב' : 'Stable')}
                    </div>
                    <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>
                      {progress.improvements} {isHe ? 'שיפורים' : 'improvements'} · {progress.escalations} {isHe ? 'הסלמות' : 'escalations'} · {progress.total} {isHe ? 'סה"כ' : 'total'}
                    </div>
                  </div>
                </div>
              )}

              {/* Gauges */}
              <div style={{ background: t.surface, borderRadius: 14, padding: 18, border: `1px solid ${t.border}`, marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>{isHe ? 'תמונת מצב' : 'Status'}</div>
                <Gauge label={isHe ? 'ויסות הילד' : 'Child regulation'} value={state.childReg} color={t.accent} t={t} />
                <Gauge label={isHe ? 'ויסות ההורים' : 'Parent regulation'} value={state.parentReg} color={t.purple} t={t} />
                <Gauge label={isHe ? 'התאמה בין ההורים' : 'Parental alignment'} value={state.alignment} color={t.green} t={t} />
                <Gauge label={isHe ? 'עוצמת קונפליקט' : 'Conflict intensity'} value={state.conflict} color={t.red} t={t} />
                <Gauge label={isHe ? 'אמון' : 'Trust'} value={state.trust} color={t.orange} t={t} />
              </div>

              {/* Ask for weekly review */}
              {caseData.events.length >= 3 && (
                <button onClick={() => { setTab('chat'); sendText(isHe ? 'תן לי תמונה כוללת' : 'Give me the big picture'); }} style={{ width: '100%', padding: '14px', borderRadius: 12, border: `1px solid ${t.accent}30`, background: t.accent + '10', color: t.accent, cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <AdvisorAvatar expression="thinking" size={24} showGlow={false} theme={t} />
                  {isHe ? 'בקש סיכום וכיוון מהיועץ' : 'Ask advisor for summary'}
                </button>
              )}

              <div style={{ background: t.surface, borderRadius: 14, padding: 18, border: `1px solid ${t.border}`, marginTop: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{isHe ? 'ניהול זיכרון' : 'Memory controls'}</div>
                <p style={{ fontSize: 12, color: t.textDim, lineHeight: 1.55, marginBottom: 12 }}>
                  {isHe ? 'המידע נשמר מקומית בדפדפן הזה. אפשר לייצא, למחוק, או לאפס רק את השיחה שעל המסך.' : 'Data is stored locally in this browser. You can export it, clear it, or reset only the visible chat.'}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={exportMemory} style={{ padding: '9px 12px', borderRadius: 10, border: `1px solid ${t.border}`, background: t.surfaceAlt, color: t.textSoft, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>{isHe ? 'ייצוא JSON' : 'Export JSON'}</button>
                  <button onClick={resetSessionView} style={{ padding: '9px 12px', borderRadius: 10, border: `1px solid ${t.border}`, background: t.surfaceAlt, color: t.textSoft, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>{isHe ? 'איפוס שיחה' : 'Reset chat'}</button>
                  <button onClick={clearMemory} style={{ padding: '9px 12px', borderRadius: 10, border: `1px solid ${t.red}40`, background: t.red + '12', color: t.red, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>{isHe ? 'מחיקת זיכרון' : 'Clear memory'}</button>
                </div>
              </div>
            </>}
          </div>
        )}

        {/* SIMULATION */}
        {tab === 'sim' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, WebkitOverflowScrolling: 'touch' }}>
            <div style={{ background: t.surface, borderRadius: 14, padding: 18, border: `1px solid ${t.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <AdvisorAvatar expression="encouraging" size={32} showGlow={false} theme={t} />
                <div style={{ fontSize: 14, fontWeight: 600 }}>{isHe ? 'חדר תרגול' : 'Practice room'}</div>
              </div>
              <p style={{ fontSize: 12, color: t.textDim, marginBottom: 16, marginTop: 4, lineHeight: 1.5 }}>
                {isHe ? 'אני אשחק את הילד. אתם תענו. אתן משוב אחרי כל תשובה.' : "I'll play the child. You respond. I'll give feedback."}
              </p>
              {scenarios.map(s => (
                <button key={s.id} onClick={() => startSim(s)} disabled={typing} style={{ display: 'block', width: '100%', padding: '14px 16px', marginBottom: 8, background: t.surfaceAlt, border: `1px solid ${t.border}`, borderRadius: 12, color: t.text, cursor: typing ? 'default' : 'pointer', textAlign: isHe ? 'right' : 'left', fontFamily: 'inherit', opacity: typing ? 0.5 : 1, transition: 'all .15s' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{s.title}</div>
                  <div style={{ fontSize: 12, color: t.textDim }}>{s.context}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      <style>{`
        ::-webkit-scrollbar-thumb { background: ${t.scrollThumb}; }
        @keyframes micPulse { 0%,100% { box-shadow: 0 0 0 0 ${t.red}40; } 50% { box-shadow: 0 0 0 6px ${t.red}00; } }
      `}</style>
    </div>
  );
}
