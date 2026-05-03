export function computeState(events) {
  const recent = events.slice(-6);
  const escalations = recent.filter(event => event.outcome === 'escalation').length;
  const improvements = recent.filter(event => event.outcome === 'improvement').length;
  const clamp = value => Math.max(0.08, Math.min(0.95, value));

  return {
    childReg: clamp(0.5 - escalations * 0.11 + improvements * 0.14),
    parentReg: clamp(0.55 - escalations * 0.07 + improvements * 0.1),
    alignment: clamp(0.6 + improvements * 0.05 - escalations * 0.04),
    conflict: clamp(0.35 + escalations * 0.14 - improvements * 0.11),
    recurrence: clamp(0.4 + events.length * 0.025),
    trust: clamp(0.5 + improvements * 0.07 - escalations * 0.05),
    risk: escalations >= 3 ? 'high' : escalations >= 1 ? 'medium' : 'low',
  };
}

export function extractEvent(msg) {
  let type = 'general';
  let trigger = null;
  let outcome = 'neutral';

  if (/מסך|טלוויזיה|אייפד|טאבלט|פלאפון|טלפון|מחשב|screen|ipad|tablet|tv|phone/i.test(msg)) {
    type = 'screen';
    trigger = 'מסך';
  }
  if (/מעבר|יציאה|ארוחה|להתלבש|לצאת|שינה|transition|meal|leave|dress|bedtime/i.test(msg)) {
    type = 'transition';
    trigger = 'מעבר';
  }
  if (/מציק|מכה|דוחף|אחים|sibling|hit|push|bother/i.test(msg)) {
    type = 'sibling';
    trigger = 'אחים';
  }
  if (/שיעורי בית|לימודים|ללמוד|homework|study/i.test(msg)) {
    type = 'homework';
    trigger = 'לימודים';
  }
  if (/צרח|פיצוץ|בכי|כעס|היסטריה|זרק|בעט|התפרצ|צעק|scream|meltdown|cry|anger|threw|kick|yell/i.test(msg)) {
    outcome = 'escalation';
  }
  if (/הצליח|עבד|שיפור|טוב|יפה|הפתיע|נהדר|succeed|work|improv|good|great/i.test(msg)) {
    outcome = 'improvement';
  }
  if (/איום|עונש|איימנו|threat|punish/i.test(msg)) {
    outcome = 'escalation';
  }

  return {
    id: `e${Date.now()}`,
    type,
    trigger,
    outcome,
    raw: msg,
    date: new Date().toISOString().split('T')[0],
  };
}

export function selectPolicy(state) {
  if (state.risk === 'high') {
    return {
      obj: 'הגנה והרגעה',
      strat: 'גבול קצר, בלי הסברים ארוכים',
      avoid: 'עונשים גדולים, ויכוח, משא ומתן בזמן סערה',
      mode: 'safety',
    };
  }

  if (state.risk === 'medium' || state.conflict > 0.45) {
    return {
      obj: 'הורדת מתח בלי לוותר על גבול',
      strat: 'תיקוף קצר ואז גבול ברור',
      avoid: 'הסברים ארוכים, איומים, עודף דיבור',
      mode: 'coach',
    };
  }

  if (state.childReg > 0.6) {
    return {
      obj: 'חיזוק התקדמות',
      strat: 'שיקוף חיובי ושימור מה שעבד',
      avoid: 'חזרה מיותרת לכשלונות',
      mode: 'strategist',
    };
  }

  return {
    obj: 'הקשבה והבנה',
    strat: 'שאלה ממוקדת אחת',
    avoid: 'ביקורת, אבחון מהיר, עומס',
    mode: 'listener',
  };
}

export function detectCommand(msg) {
  const normalized = msg
    .trim()
    .toLowerCase()
    .replace(/[.!?؟،,]+$/g, '')
    .replace(/\s+/g, ' ');

  if (normalized.length > 32 || normalized.split(' ').length > 4) return null;

  const darkCommands = new Set(['dark mode', 'מצב כהה', 'תעבור לכהה', 'עיצוב כהה']);
  const lightCommands = new Set(['light mode', 'מצב בהיר', 'תעבור לבהיר', 'עיצוב בהיר']);
  const englishCommands = new Set(['english', 'אנגלית', 'תעבור לאנגלית', 'switch to english']);
  const hebrewCommands = new Set(['עברית', 'hebrew', 'תעבור לעברית', 'switch to hebrew']);

  if (darkCommands.has(normalized)) return { type: 'theme', value: 'dark' };
  if (lightCommands.has(normalized)) return { type: 'theme', value: 'light' };
  if (englishCommands.has(normalized)) return { type: 'lang', value: 'en' };
  if (hebrewCommands.has(normalized)) return { type: 'lang', value: 'he' };
  return null;
}

function hasAny(text, words) {
  const lower = text.toLowerCase();
  return words.some(word => lower.includes(word.toLowerCase()));
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isShortFragment(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes('?')) return false;
  if (wordCount(trimmed) > 4) return false;
  if (/[.!]/.test(trimmed)) return false;

  return !hasAny(trimmed, [
    'today', 'yesterday', 'happened', 'meltdown', 'screaming', 'screen',
    'היום', 'אתמול', 'קרה', 'פיצוץ', 'צרחות', 'צעק', 'בכי', 'מסך', 'ריב',
  ]);
}

function isGreeting(text) {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[!?.,"'\s]+$/g, '')
    .replace(/\s+/g, ' ');
  return ['שלום', 'היי', 'הי', 'אהלן', 'hi', 'hello'].includes(normalized);
}

function isLastTopicRequest(text) {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[!?.,"'\s]+$/g, '')
    .replace(/\s+/g, ' ');

  return [
    '\u05de\u05d4\u05e0\u05d5\u05e9\u05d0 \u05d4\u05d0\u05d7\u05e8\u05d5\u05df',
    '\u05d4\u05e0\u05d5\u05e9\u05d0 \u05d4\u05d0\u05d7\u05e8\u05d5\u05df',
    '\u05e0\u05d5\u05e9\u05d0 \u05d0\u05d7\u05e8\u05d5\u05df',
    '\u05dc\u05d4\u05de\u05e9\u05d9\u05da \u05de\u05d4\u05e0\u05d5\u05e9\u05d0 \u05d4\u05d0\u05d7\u05e8\u05d5\u05df',
    'last topic',
    'continue last topic',
    'continue from last topic',
  ].includes(normalized);
}

export function detectConversationType(msg) {
  const text = msg.trim();

  if (hasAny(text, ['פגע', 'מכה', 'סכין', 'התאבד', 'לא בטוח', 'מסוכן', 'hurt', 'knife', 'suicide', 'unsafe'])) return 'safety';
  if (isGreeting(text)) return 'greeting';
  if (isLastTopicRequest(text)) return 'continue_last_topic';
  if (hasAny(text, ['לא אמרתי', 'לא סיפרתי', 'איך אתה יודע', 'אתה מניח', 'אל תניח', 'i did not say', "i didn't say", 'how do you know', 'you assumed'])) return 'correction';
  if (hasAny(text, ['סימולציה', 'תרגול', 'תשחק', 'נתרגל', 'practice', 'roleplay'])) return 'simulation';
  if (hasAny(text, ['סיכום', 'השבוע', 'מה השתנה', 'weekly review'])) return 'weekly_review';
  if (hasAny(text, ['תמונה כוללת', 'תמונת מצב', 'מה המצב', 'מה אתה רואה', 'big picture', 'status'])) return 'big_picture';
  if (hasAny(text, ['תוכנית', 'מה לעשות', 'צעדים', 'איך להגיב', 'מה להגיד', 'plan', 'what should'])) return 'action_plan';
  if (hasAny(text, ['נמאס', 'לא מסוגל', 'שחוקים', 'מיואש', 'מתוסכל', 'קשה לי', 'exhausted', 'hopeless'])) return 'distress';
  if (isShortFragment(text)) return 'fragment';
  if (hasAny(text, ['היום', 'אתמול', 'קרה', 'פיצוץ', 'צרחות', 'צעק', 'בכי', 'מסך', 'כיבוי', 'מעבר', 'ריב', 'meltdown', 'screaming', 'screen'])) return 'event';
  return 'open';
}

export function checkContextSufficiency(msg, conversationType) {
  if (['greeting', 'open', 'fragment', 'correction', 'continue_last_topic', 'distress'].includes(conversationType)) {
    return { enoughForEvent: false, enoughForSynthesis: false, missing: 'event_details' };
  }

  if (['big_picture', 'weekly_review', 'action_plan', 'simulation', 'safety'].includes(conversationType)) {
    return { enoughForEvent: false, enoughForSynthesis: true, missing: null };
  }

  const hasTrigger = hasAny(msg, ['מסך', 'כיבוי', 'מעבר', 'טלפון', 'טלוויזיה', 'אייפד', 'screen', 'transition']);
  const hasReaction = hasAny(msg, ['פיצוץ', 'צרחות', 'צעק', 'בכי', 'סירב', 'השתולל', 'meltdown', 'screaming', 'refused']);
  const hasParentMove = hasAny(msg, ['אמרתי', 'אמרנו', 'הסבר', 'איימ', 'לקחתי', 'גבול', 'התראה', 'I said', 'we said', 'warning']);

  return {
    enoughForEvent: hasTrigger && hasReaction && hasParentMove,
    enoughForSynthesis: hasTrigger && hasReaction && hasParentMove,
    missing: hasTrigger && hasReaction && hasParentMove ? null : hasTrigger && hasReaction ? 'parent_response' : 'event_context',
  };
}

export function routeMessage(msg) {
  const conversationType = detectConversationType(msg);
  const context = checkContextSufficiency(msg, conversationType);

  if (conversationType === 'safety') return { mode: 'safety', synthesis: true, context };
  if (conversationType === 'greeting') return { mode: 'greeting', synthesis: false, context };
  if (conversationType === 'continue_last_topic') return { mode: 'continue_last_topic', synthesis: false, context };
  if (conversationType === 'correction') return { mode: 'correction', synthesis: false, context };
  if (conversationType === 'fragment') return { mode: 'fragment_intake', synthesis: false, context };
  if (conversationType === 'open') return { mode: 'clarifying', synthesis: false, context };
  if (conversationType === 'distress') return { mode: 'empathic', synthesis: false, context };
  if (conversationType === 'simulation') return { mode: 'simulation', synthesis: false, context };
  if (conversationType === 'action_plan') return { mode: 'action_plan', synthesis: false, context };
  if (conversationType === 'weekly_review') return { mode: 'weekly_review', synthesis: true, context };
  if (conversationType === 'big_picture') return { mode: 'big_picture', synthesis: true, context };
  if (conversationType === 'event' && !context.enoughForSynthesis) return { mode: 'event_intake', synthesis: false, context };
  return { mode: 'analytical', synthesis: true, context };
}
