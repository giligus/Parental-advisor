// State Engine — computes emotional/behavioral state from event history
export function computeState(events) {
  const recent = events.slice(-6);
  const esc = recent.filter(e => e.outcome === 'escalation').length;
  const imp = recent.filter(e => e.outcome === 'improvement').length;
  const clamp = (v) => Math.max(0.08, Math.min(0.95, v));

  return {
    childReg: clamp(0.5 - esc * 0.11 + imp * 0.14),
    parentReg: clamp(0.55 - esc * 0.07 + imp * 0.1),
    alignment: clamp(0.6 + imp * 0.05 - esc * 0.04),
    conflict: clamp(0.35 + esc * 0.14 - imp * 0.11),
    recurrence: clamp(0.4 + events.length * 0.025),
    trust: clamp(0.5 + imp * 0.07 - esc * 0.05),
    risk: esc >= 3 ? 'high' : esc >= 1 ? 'medium' : 'low',
  };
}

// Event Extraction — parses user message into structured event
export function extractEvent(msg) {
  let type = 'general', trigger = null, outcome = 'neutral';

  if (/מסך|טלוויזיה|אייפד|טאבלט|פלאפון|מחשב|screen|ipad|tablet|tv/i.test(msg)) {
    type = 'screen'; trigger = 'מסך';
  }
  if (/מעבר|יציאה|ארוחה|להתלבש|לצאת|שינה|transition|meal|leave|dress/i.test(msg)) {
    type = 'transition'; trigger = 'מעבר';
  }
  if (/מציק|מכה|דוחף|אחים|sibling|hit|push|bother/i.test(msg)) {
    type = 'sibling'; trigger = 'אחים';
  }
  if (/שיעורי בית|לימודים|ללמוד|homework|study/i.test(msg)) {
    type = 'homework'; trigger = 'לימודים';
  }
  if (/צרח|פיצוץ|בכי|כעס|היסטריה|זרק|בעט|התפרצ|scream|meltdown|cry|anger|threw|kick/i.test(msg)) {
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
    date: new Date().toISOString().split('T')[0],
  };
}

// Policy Engine — selects strategy based on current state
export function selectPolicy(state) {
  if (state.risk === 'high') {
    return {
      obj: 'הגנה והרגעה',
      strat: 'גבול קצר, ללא הסברים',
      avoid: 'עונשים חמורים, ויכוח',
      mode: 'safety',
    };
  }
  if (state.conflict > 0.55) {
    return {
      obj: 'הורדת הסלמה',
      strat: 'אישור קצר + גבול',
      avoid: 'הסברים ארוכים, איומים',
      mode: 'coach',
    };
  }
  if (state.childReg > 0.6) {
    return {
      obj: 'חיזוק התקדמות',
      strat: 'שיקוף חיובי',
      avoid: 'הזכרת כשלונות',
      mode: 'strategist',
    };
  }
  return {
    obj: 'הקשבה והבנה',
    strat: 'שאלות ממוקדות',
    avoid: 'ביקורת, עומס',
    mode: 'listener',
  };
}

// Command Detection — settings changes via chat
export function detectCommand(msg) {
  const lower = msg.toLowerCase();
  if (/dark\s*mode|מצב כהה|תעבור לכהה|עיצוב כהה/.test(lower)) return { type: 'theme', value: 'dark' };
  if (/light\s*mode|מצב בהיר|תעבור לבהיר|עיצוב בהיר/.test(lower)) return { type: 'theme', value: 'light' };
  if (/english|אנגלית|תעבור לאנגלית|switch.*(to|lang).*eng/.test(lower)) return { type: 'lang', value: 'en' };
  if (/עברית|hebrew|תעבור לעברית|switch.*(to|lang).*heb/.test(lower)) return { type: 'lang', value: 'he' };
  return null;
}

function hasAny(text, words) {
  const lower = text.toLowerCase();
  return words.some(word => lower.includes(word.toLowerCase()));
}

export function detectConversationType(msg) {
  const text = msg.trim();
  const compact = text.replace(/[!?.؟,،\s]/g, '');

  if (hasAny(text, ['פגע', 'מכה', 'סכין', 'התאבד', 'לא בטוח', 'מסוכן', 'hurt', 'knife', 'suicide', 'unsafe'])) return 'safety';
  if (compact.length <= 18 && hasAny(compact, ['שלום', 'היי', 'הי', 'אהלן', 'hi', 'hello'])) return 'greeting';
  if (hasAny(text, ['סימולציה', 'תרגול', 'תשחק', 'נתרגל', 'practice', 'roleplay'])) return 'simulation';
  if (hasAny(text, ['סיכום', 'השבוע', 'מה השתנה', 'weekly review'])) return 'weekly_review';
  if (hasAny(text, ['תמונה כוללת', 'תמונת מצב', 'מה המצב', 'מה אתה רואה', 'big picture', 'status'])) return 'big_picture';
  if (hasAny(text, ['תוכנית', 'מה לעשות', 'צעדים', 'איך להגיב', 'מה להגיד', 'plan', 'what should'])) return 'action_plan';
  if (hasAny(text, ['נמאס', 'לא מסוגל', 'שחוקים', 'מיואש', 'מתוסכל', 'קשה לי', 'exhausted', 'hopeless'])) return 'distress';
  if (hasAny(text, ['היום', 'אתמול', 'קרה', 'פיצוץ', 'צרחות', 'צעק', 'בכי', 'מסך', 'כיבוי', 'מעבר', 'ריב', 'meltdown', 'screaming', 'screen'])) return 'event';
  return 'open';
}

export function checkContextSufficiency(msg, conversationType) {
  if (['greeting', 'open', 'distress'].includes(conversationType)) {
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
    missing: hasTrigger && hasReaction ? 'parent_response' : 'start_of_escalation',
  };
}

export function routeMessage(msg) {
  const conversationType = detectConversationType(msg);
  const context = checkContextSufficiency(msg, conversationType);

  if (conversationType === 'safety') return { mode: 'safety', synthesis: true, context };
  if (conversationType === 'greeting') return { mode: 'greeting', synthesis: false, context };
  if (conversationType === 'open') return { mode: 'clarifying', synthesis: false, context };
  if (conversationType === 'distress') return { mode: 'empathic', synthesis: false, context };
  if (conversationType === 'simulation') return { mode: 'simulation', synthesis: false, context };
  if (conversationType === 'action_plan') return { mode: 'action_plan', synthesis: false, context };
  if (conversationType === 'weekly_review') return { mode: 'weekly_review', synthesis: true, context };
  if (conversationType === 'big_picture') return { mode: 'big_picture', synthesis: true, context };
  if (conversationType === 'event' && !context.enoughForSynthesis) return { mode: 'event_intake', synthesis: false, context };
  return { mode: 'analytical', synthesis: true, context };
}
