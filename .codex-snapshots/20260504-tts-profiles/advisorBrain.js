const CASE_KEY = 'behavioral_advisor_case_v2';

const EMPTY_CASE = {
  profiles: {},
  events: [],
  insights: [],
  activeProfileId: null,
  activeFocus: null,
};

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function profileId(name = '') {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

function cleanName(value = '') {
  const cleaned = value.replace(/[?.!,״"]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 28) return null;
  if (/^(הוא|היא|אני|אנחנו|אתם|אתן|ילד|ילדה|בן|בת|שלו|שלה|he|she|they|child)$/i.test(cleaned)) return null;
  if (/(מסך|פיצוץ|ריב|בעיה|הצק|מציק|צעק|בכה|screen|problem|meltdown)/i.test(cleaned)) return null;
  return cleaned;
}

function detectConcern(text, lang) {
  const concerns = [
    { id: 'sibling_friction', he: 'חיכוך או הצקות בין אחים', en: 'sibling friction or teasing', re: /(הצק|מציק|אחים|אחיו|אחותו|sibling|brother|sister|teas|bother)/i },
    { id: 'screen_transition', he: 'מסכים ומעברים', en: 'screens and transitions', re: /(מסך|מסכים|כיבוי|טלפון|טלוויזיה|screen|phone|tablet|tv)/i },
    { id: 'emotional_outburst', he: 'התפרצות או רגע טעון', en: 'an emotional outburst', re: /(פיצוץ|התפרצות|צרח|צעק|בכי|בכה|ריב|meltdown|scream|yell|cry|fight)/i },
    { id: 'routine_homework', he: 'שגרה או שיעורים', en: 'routine or homework', re: /(שיעורים|בית ספר|בוקר|שינה|homework|school|morning|bedtime|sleep)/i },
  ];
  const found = concerns.find(item => item.re.test(text));
  return found ? { id: found.id, label: lang === 'he' ? found.he : found.en } : null;
}

function extractNames(text) {
  const names = [];
  const patterns = [
    /(?:על|של|עם)\s+([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})/giu,
    /(?:קוראים לו|קוראים לה|בשם|שמו|שמה)\s+([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})/giu,
    /(?:הבן שלי|הבת שלי|בני|בתי)\s+([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})/giu,
    /([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})\s+(?:מציק|מציקה|צורח|צועק|בוכה|מרביץ|דוחף|refuses|screams|bothers|hits|pushes)/giu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = cleanName(match[1]);
      if (name) names.push(name);
    }
  }
  return unique(names);
}

function extractEvent(text) {
  const concern = detectConcern(text, 'he');
  const hasEventLanguage = /(היום|אתמול|קרה|היה|שוב|פיצוץ|צעק|בכה|ריב|מציק|מסך|כיבוי|today|yesterday|happened|again|meltdown|screen)/i.test(text);
  if (!concern && !hasEventLanguage) return null;

  let outcome = 'neutral';
  if (/(הצליח|עבד|שיפור|יותר טוב|נרגע|success|worked|better|improv)/i.test(text)) outcome = 'improvement';
  if (/(פיצוץ|צרח|צעק|בכה|ריב|איום|עונש|הרביץ|דחף|meltdown|scream|yell|cry|hit|push|threat|punish)/i.test(text)) outcome = 'escalation';

  return {
    id: `e${Date.now()}`,
    raw: text,
    type: concern?.id || 'general',
    trigger: concern?.label || null,
    outcome,
    date: new Date().toISOString().slice(0, 10),
  };
}

function routeMessage(text) {
  const trimmed = text.trim();
  if (/^(שלום|היי|הי|אהלן|hi|hello)$/i.test(trimmed)) return 'greeting';
  if (/(תמונה כוללת|תמונת מצב|סיכום|מה המצב|big picture|status|summary|weekly)/i.test(trimmed)) return 'big_picture';
  if (/(תרגול|סימולציה|נשחק|roleplay|practice|simulation)/i.test(trimmed)) return 'simulation';
  if (/(מה לעשות|איך להגיב|תוכנית|צעדים|what should|plan|how should)/i.test(trimmed)) return 'action_plan';
  if (/(נמאס|לא מסוגל|שחוקים|מיואש|קשה לי|exhausted|hopeless|overwhelmed)/i.test(trimmed)) return 'empathic';
  if (extractEvent(trimmed)) return 'event';
  if (extractNames(trimmed).length > 0 || /(לדבר על|רוצה לדבר|tell you about|talk about)/i.test(trimmed)) return 'topic_intake';
  return 'open';
}

function computeState(events = []) {
  const recent = events.slice(-6);
  const escalations = recent.filter(event => event.outcome === 'escalation').length;
  const improvements = recent.filter(event => event.outcome === 'improvement').length;
  const clamp = value => Math.max(0.08, Math.min(0.95, value));
  return {
    childRegulation: clamp(0.55 - escalations * 0.1 + improvements * 0.12),
    parentRegulation: clamp(0.58 - escalations * 0.07 + improvements * 0.08),
    alignment: clamp(0.6 - escalations * 0.03 + improvements * 0.04),
    conflict: clamp(0.28 + escalations * 0.13 - improvements * 0.1),
    recurrence: clamp(0.25 + recent.length * 0.08),
    risk: escalations >= 3 ? 'high' : escalations >= 1 ? 'medium' : 'low',
  };
}

function selectPolicy(state, route, event) {
  if (state.risk === 'high') {
    return {
      mode: 'safety',
      objective: 'להוריד עומס ולשמור על ביטחון לפני שמלמדים או מסבירים',
      strategy: 'תגובה קצרה, רגועה וצמודה למה שקורה עכשיו',
      avoid: 'הרצאות, איומים, עונשים גדולים או משא ומתן ברגע טעון',
    };
  }
  if (route === 'big_picture') {
    return {
      mode: 'synthesis',
      objective: 'לחבר את הפרטים לתמונה פשוטה וברורה',
      strategy: 'לשקף מה חוזר, מה עובד ומה הצעד הבא',
      avoid: 'להציג נתונים או שמות פנימיים של המערכת',
    };
  }
  if (event?.outcome === 'improvement') {
    return {
      mode: 'strategist',
      objective: 'לחזק את מה שכבר התחיל לעבוד',
      strategy: 'לזהות מה בדיוק עזר ולבנות ממנו חזרה עקבית',
      avoid: 'לעבור מהר מדי לבעיה הבאה',
    };
  }
  if (route === 'event' || route === 'action_plan') {
    return {
      mode: 'coach',
      objective: 'לתת כיוון מעשי בלי לאבד חמימות',
      strategy: 'שיקוף קצר ואז צעד אחד שאפשר לנסות',
      avoid: 'ניתוח ארוך מדי או יותר מדי הוראות בבת אחת',
    };
  }
  return {
    mode: 'listener',
    objective: 'להבין את ההקשר לפני שמנתחים',
    strategy: 'שאלה אחת קצרה וממוקדת',
    avoid: 'לקפוץ למסקנות או להמציא פרטים',
  };
}

function mergeProfile(existing, name, lang, concern) {
  const old = existing || {};
  return {
    name,
    role: old.role || 'child',
    age: old.age || null,
    challenges: unique([...(old.challenges || []), concern?.label]).slice(0, 8),
    strengths: old.strengths || [],
    triggers: unique([...(old.triggers || []), concern?.label]).slice(0, 8),
    whatWorks: old.whatWorks || [],
    notes: old.notes || (lang === 'he' ? 'נוצר מתוך השיחה.' : 'Created from the conversation.'),
  };
}

export function loadAdvisorCase() {
  try {
    return { ...EMPTY_CASE, ...(JSON.parse(localStorage.getItem(CASE_KEY)) || {}) };
  } catch {
    return EMPTY_CASE;
  }
}

export function saveAdvisorCase(caseData) {
  localStorage.setItem(CASE_KEY, JSON.stringify(caseData));
}

export function prepareAdvisorTurn({ message, caseData, lang, persona }) {
  const route = routeMessage(message);
  const concern = detectConcern(message, lang);
  const names = extractNames(message);
  const event = extractEvent(message);
  const next = {
    ...EMPTY_CASE,
    ...caseData,
    profiles: { ...(caseData.profiles || {}) },
    events: [...(caseData.events || [])],
    insights: [...(caseData.insights || [])],
  };

  let activeProfileId = next.activeProfileId;
  for (const name of names) {
    const id = profileId(name);
    next.profiles[id] = mergeProfile(next.profiles[id], name, lang, concern);
    activeProfileId = id;
  }

  if (event) next.events = [...next.events, event].slice(-60);
  if (activeProfileId) next.activeProfileId = activeProfileId;
  if (concern || names.length > 0) {
    next.activeFocus = {
      id: concern?.id || 'person_context',
      label: concern?.label || names[0],
      profileId: activeProfileId || null,
      updatedAt: new Date().toISOString(),
    };
  }

  const state = computeState(next.events);
  const policy = selectPolicy(state, route, event);
  const activeProfile = next.activeProfileId ? next.profiles[next.activeProfileId] : null;

  const system = buildSystemPrompt({ lang, persona, caseData: next, route, event, state, policy, activeProfile });
  return { caseData: next, route, event, state, policy, system };
}

function buildSystemPrompt({ lang, persona, caseData, route, event, state, policy, activeProfile }) {
  const he = lang === 'he';
  const name = persona ? (he ? persona.name : persona.nameEn) : (he ? 'מאיה' : 'Maya');
  const profiles = Object.values(caseData.profiles || {});
  const recentEvents = (caseData.events || []).slice(-5);
  const focus = caseData.activeFocus;

  if (he) {
    return `את ${name}, יועצת הורית והתנהגותית מתמשכת. את מדברת בעברית טבעית, חמה וישירה, כמו יועצת אנושית שמכירה את התיק אבל לא נשמעת כמו מערכת.

העיקרון שלך: קודם אנושי, אחר כך מתודולוגי. אל תחשפי שמות פנימיים כמו מצב, מנוע, מדיניות, סינתזה או פרופיל. אל תציגי מספרים, אחוזים, כותרות, markdown או רשימות. עני ב-2 עד 5 משפטים קצרים. אם חסר מידע, שאלי שאלה אחת בלבד. אם יש אירוע ברור, התייחסי אליו ישירות ולא כאילו לא סופר.

הנחיית תגובה שקטה: ${responseGuideHe(route)}
האדם שבמוקד: ${activeProfile ? `${activeProfile.name}, ${activeProfile.role || 'ילד'}` : 'לא ידוע עדיין'}
המוקד הפעיל: ${focus?.label || 'עדיין מתברר'}
אירוע נוכחי: ${event ? `${event.raw} | כיוון: ${event.type} | תוצאה: ${event.outcome}` : 'אין אירוע ברור בהודעה הזאת'}
כיוון ייעוצי פנימי: מטרה - ${policy.objective}; דרך - ${policy.strategy}; להימנע מ - ${policy.avoid}
תמונת תיק קצרה: ${recentEvents.length ? recentEvents.map(item => `${item.type}/${item.outcome}: ${item.raw}`).join(' | ') : 'עדיין אין מספיק היסטוריה'}
פרופילים מוכרים: ${profiles.length ? profiles.map(item => `${item.name}: ${(item.challenges || []).join(', ') || 'אין עדיין מספיק מידע'}`).join(' | ') : 'אין עדיין פרופילים'}

חשוב: השתמשי בהקשר הזה רק כדי להישמע רציפה וחכמה. אל תדווחי עליו כנתונים.`;
  }

  return `You are ${name}, a continuous parenting and behavioral advisor. Speak naturally, warmly, and directly, like a human advisor who knows the case without sounding like a system.

Principle: human first, method second. Do not reveal internal labels such as mode, engine, policy, synthesis, or profile. No numbers, percentages, headings, markdown, or bullet lists. Reply in 2 to 5 short sentences. If information is missing, ask exactly one question. If the user reported an event, respond to that event directly.

Quiet response guide: ${responseGuideEn(route)}
Active person: ${activeProfile ? `${activeProfile.name}, ${activeProfile.role || 'child'}` : 'not known yet'}
Active focus: ${focus?.label || 'still forming'}
Current event: ${event ? `${event.raw} | direction: ${event.type} | outcome: ${event.outcome}` : 'no clear event in this message'}
Internal advisory direction: objective - ${policy.objective}; strategy - ${policy.strategy}; avoid - ${policy.avoid}
Short case picture: ${recentEvents.length ? recentEvents.map(item => `${item.type}/${item.outcome}: ${item.raw}`).join(' | ') : 'not enough history yet'}
Known profiles: ${profiles.length ? profiles.map(item => `${item.name}: ${(item.challenges || []).join(', ') || 'limited information'}`).join(' | ') : 'none yet'}

Use this context only to sound continuous and intelligent. Do not report it as data.`;
}

function responseGuideHe(route) {
  const map = {
    greeting: 'זו רק ברכה. עני קצר וחם, והזמיני בעדינות לספר במה להתמקד.',
    topic_intake: 'המשתמש מסמן אדם או נושא. הכירי בזה ושאלי שאלה אחת שמקדמת הבנה, לא שאלה כללית מדי.',
    event: 'זה דיווח על אירוע. תני שיקוף קצר, חברי בעדינות לכיוון אפשרי, ושאלי רק פרט חסר אחד אם צריך.',
    action_plan: 'המשתמש מבקש כיוון. תני צעד אחד ברור או ניסוח קצר.',
    big_picture: 'המשתמש מבקש תמונה כוללת. סכמי בעדינות מה נראה שחוזר ומה הפוקוס הבא.',
    empathic: 'יש עומס רגשי. קודם תיקוף רגשי, אחר כך שאלה אחת עדינה או צעד קטן.',
    simulation: 'הזמיני לתרגול טבעי וקצר.',
    open: 'פתיחה כללית. אל תנתחי. שאלי שאלה אחת מזמינה.',
  };
  return map[route] || map.open;
}

function responseGuideEn(route) {
  const map = {
    greeting: 'This is only a greeting. Reply briefly and warmly, then invite focus.',
    topic_intake: 'The user is marking a person or topic. Acknowledge it and ask one useful next question.',
    event: 'This is an event report. Reflect briefly, connect gently to a possible direction, and ask only one missing detail if needed.',
    action_plan: 'The user wants direction. Give one clear next step or one short script.',
    big_picture: 'The user wants the bigger picture. Summarize what seems to repeat and the next focus.',
    empathic: 'The user sounds emotionally loaded. Validate first, then one gentle question or small step.',
    simulation: 'Invite a short natural practice.',
    open: 'Open start. Do not analyze. Ask one inviting question.',
  };
  return map[route] || map.open;
}
