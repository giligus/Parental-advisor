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

function newId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}${uuid || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`}`;
}

function profileId(name = '') {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

function cleanName(value = '') {
  const cleaned = value.replace(/[?.!,״"]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 28) return null;
  if (/^(הוא|היא|אני|אנחנו|אתם|אתן|ילד|ילדה|בן|בת|שלו|שלה|אמר|אמרה|כי|שוב|היום|אתמול|או|ו|של|עם|בין|לפעמים|היי|שלום|הגדול|הגדולה|הקטן|הקטנה|he|she|they|child|said|or|and|with|between|oldest|youngest)$/i.test(cleaned)) return null;
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

function extractPeople(text, recentMessages = []) {
  const candidates = [];
  const patterns = [
    { role: 'child', confidence: 0.96, re: /(?:הבן שלי|הבת שלי|בני|בתי|my son|my daughter)\s+([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})/giu },
    { role: 'child', confidence: 0.94, re: /([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})\s*,?\s*(?:הבן שלי|הבת שלי|בני|בתי|my son|my daughter)/giu },
    { role: 'parent', confidence: 0.96, re: /(?:אשתי|בעלי|בן זוגי|בת זוגי|my wife|my husband|my partner)\s+([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})/giu },
    { role: 'parent', confidence: 0.94, re: /([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})\s*,?\s*(?:אשתי|בעלי|בן זוגי|בת זוגי|my wife|my husband|my partner)/giu },
    { role: 'professional', confidence: 0.94, re: /(?:המורה|הגננת|הסייעת|המטפלת|המטפל|teacher|therapist)\s+([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})/giu },
    { role: 'unknown', confidence: 0.88, nameGroups: [1, 2], re: /(?:בין|between)\s+([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})\s+(?:ו|לבין|and)\s*([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})/giu },
    { role: 'unknown', confidence: 0.84, nameGroups: [1, 2], re: /([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})\s+ו([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})\s+(?:רבים|רבות|מתווכחים|מתווכחות|מתקוטטים|נלחמים|fight|argue)/giu },
    { role: 'child', confidence: 0.92, ageGroup: 2, re: /(?:לא[,\s]+)?([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})\s+(?:הוא|היא)\s+(?:הגדול|הגדולה|הקטן|הקטנה|בן|בת)(?:\s+(?:בן|בת))?\s*(\d+(?:[.,]\d+)?)?/giu },
    { role: 'child', confidence: 0.9, ageGroup: 2, re: /([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})\s+(?:בן|בת)\s+(\d+(?:[.,]\d+)?)/giu },
    { role: 'unknown', confidence: 0.86, re: /(?:קוראים לו|קוראים לה|בשם|שמו|שמה|named)\s+([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})/giu },
    { role: 'unknown', confidence: 0.82, re: /(?:ביקשנו מ|אמרנו ל|נתנו ל|שאלנו את|asked |told )([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})/giu },
    { role: 'child', confidence: 0.74, re: /(?:אמר|אמרה|דיווח|דיווחה)\s+ש([\u0590-\u05FF][\u0590-\u05FF'-]{1,22})\s+(?:מציק|מציקה|צורח|צועק|בוכה|מרביץ|דוחף)/giu },
    { role: 'unknown', confidence: 0.72, re: /(?:לדבר על|רוצה לדבר על|tell you about|talk about|עם|with)\s+([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})/giu },
    { role: 'unknown', confidence: 0.82, re: /(?:היום|אתמול|שוב|אז|today|yesterday|again)\s+([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})\s+(?:הציק|הציקה|מציק|מציקה|צרח|צרחה|צעק|צעקה|בכה|בכתה|הרביץ|הרביצה|דחף|דחפה|התנגד|התנגדה|סירב|סירבה|מחזיק|מחזיקה|refused|screamed|yelled|cried|hit|pushed|held|is holding)/giu },
    { role: 'unknown', confidence: 0.78, re: /(?:^|[.!?]\s*)([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22})\s+(?:מציק|מציקה|צורח|צורחת|צועק|צועקת|בוכה|מרביץ|מרביצה|דוחף|דוחפת|מסרב|מסרבת|מחזיק|מחזיקה|refuses|screams|bothers|hits|pushes|holds|is holding)/giu },
  ];

  for (const { role, confidence, re, nameGroups = [1], ageGroup = null } of patterns) {
    for (const match of text.matchAll(re)) {
      const parsedAge = ageGroup && match[ageGroup]
        ? Number(match[ageGroup].replace(',', '.'))
        : null;
      for (const group of nameGroups) {
        const name = cleanName(match[group]);
        if (name) candidates.push({
          name,
          role,
          confidence,
          age: Number.isFinite(parsedAge) ? parsedAge : null,
        });
      }
    }
  }

  const previousAdvisorMessage = [...recentMessages]
    .reverse()
    .find(message => message?.role === 'advisor' || message?.role === 'assistant');
  const askedForPerson = previousAdvisorMessage
    && /(מי|איזה מהם|איזו מהן|מה השם|מי משניהם|מי משתיהן|who|which one|what(?:'s| is) (?:his|her|their) name)/i.test(previousAdvisorMessage.text || previousAdvisorMessage.content || '');
  if (askedForPerson && /^[\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'-]{1,22}$/u.test(text.trim())) {
    const name = cleanName(text);
    if (name) candidates.push({ name, role: 'unknown', confidence: 0.72, age: null });
  }

  const people = new Map();
  for (const candidate of candidates) {
    const id = profileId(candidate.name);
    const existing = people.get(id);
    if (!existing) {
      people.set(id, candidate);
      continue;
    }
    people.set(id, {
      ...(candidate.confidence > existing.confidence ? candidate : existing),
      age: candidate.age ?? existing.age ?? null,
    });
  }
  return [...people.values()];
}

function extractEvent(text, sourceMessageId = newId('m_')) {
  const concern = detectConcern(text, 'he');
  const hasEventLanguage = /(היום|אתמול|קרה|היה|שוב|פיצוץ|צעק|בכה|ריב|מציק|מסך|כיבוי|today|yesterday|happened|again|meltdown|screen)/i.test(text);
  if (!concern && !hasEventLanguage) return null;

  let outcome = 'neutral';
  if (/(הצליח|עבד|שיפור|יותר טוב|נרגע|success|worked|better|improv)/i.test(text)) outcome = 'improvement';
  if (/(פיצוץ|צרח|צעק|בכה|ריב|איום|עונש|הרביץ|דחף|meltdown|scream|yell|cry|hit|push|threat|punish)/i.test(text)) outcome = 'escalation';

  return {
    id: newId('e_'),
    raw: text,
    type: concern?.id || 'general',
    trigger: concern?.label || null,
    outcome,
    date: new Date().toISOString().slice(0, 10),
    facts: [text],
    interpretations: [],
    alternatives: [],
    confidence: 0.58,
    status: 'provisional',
    sourceRefs: [sourceMessageId],
    safetyFlags: [],
  };
}

function assessSafety(text) {
  const immediate = /(סכין|נשק|חונק|איום להרוג|רוצה למות|פגיעה עצמית|סכנה מיידית|knife|weapon|choking|kill|suicide|self[- ]harm|immediate danger)/i.test(text);
  const safeguarding = /(התעללות|הזנחה|פגיעה מינית|אלימות קשה|מפחד לחזור הביתה|abuse|neglect|sexual harm|severe violence|afraid to go home)/i.test(text);
  return {
    requiresOverride: immediate || safeguarding,
    class: immediate ? 'immediate_danger' : safeguarding ? 'safeguarding_concern' : 'ordinary',
    evidence: immediate || safeguarding ? [text] : [],
  };
}

function hasSufficientEventContext(text, event, people) {
  if (!event) return true;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const actorMention = people.length > 0 || /(הילד|הילדה|הבן|הבת|הוא|היא|אורי|child|son|daughter|he|she)/i.test(text);
  const intervention = /(אמרנו|ביקשנו|נתנו|כיבינו|עצרנו|ניסינו|התראה|גבול|בחירה|we said|asked|warned|turned off|tried|boundary|choice)/i.test(text);
  const sequence = /(לפני|אחרי|כשה|ברגע ש|ואז|בתגובה|before|after|when|then|in response)/i.test(text);
  const clearOutcome = event.outcome === 'improvement' && intervention;
  return clearOutcome || (words.length >= 7 && actorMention && (intervention || sequence));
}

function routeMessage(text, event, contextSufficient, safety, people = []) {
  const trimmed = text.trim();
  if (safety.requiresOverride) return 'safety';
  if (/^(שלום|היי|הי|אהלן|hi|hello)$/i.test(trimmed)) return 'greeting';
  if (/(תמונה כוללת|תמונת מצב|סיכום|מה המצב|big picture|status|summary|weekly)/i.test(trimmed)) return 'big_picture';
  if (/(תרגול|סימולציה|נשחק|roleplay|practice|simulation)/i.test(trimmed)) return 'simulation';
  if (/(מה לעשות|איך להגיב|תוכנית|צעדים|what should|plan|how should)/i.test(trimmed)) return 'action_plan';
  if (/(נמאס|לא מסוגל|שחוקים|מיואש|קשה לי|exhausted|hopeless|overwhelmed)/i.test(trimmed)) return 'empathic';
  if (event) return contextSufficient ? 'event' : 'event_intake';
  if (people.length > 0 || /(לדבר על|רוצה לדבר|tell you about|talk about)/i.test(trimmed)) return 'topic_intake';
  return 'open';
}

function computeState(events = [], safety = { class: 'ordinary' }) {
  const recent = events.slice(-6);
  const escalations = recent.filter(event => event.outcome === 'escalation').length;
  const improvements = recent.filter(event => event.outcome === 'improvement').length;
  const latestType = recent.at(-1)?.type;
  const sameType = latestType ? recent.filter(event => event.type === latestType) : [];
  const evidenceRefs = recent.map(event => event.id);
  return {
    axes: {
      childRegulation: { value: escalations ? 'strained' : improvements ? 'improving' : 'unknown', confidence: recent.length ? 0.55 : 0 },
      parentRegulation: { value: 'unknown', confidence: 0 },
      parentalAlignment: { value: 'unknown', confidence: 0 },
      conflictIntensity: { value: escalations >= 2 ? 'high' : escalations === 1 ? 'moderate' : improvements ? 'lower' : 'unknown', confidence: Math.min(0.82, 0.35 + recent.length * 0.08) },
      recurrence: { value: sameType.length >= 3 ? 'repeated' : sameType.length === 2 ? 'emerging' : 'insufficient_data', confidence: Math.min(0.88, 0.3 + sameType.length * 0.18) },
      interventionReadiness: { value: 'unknown', confidence: 0 },
    },
    hypotheses: sameType.length >= 2 ? [{
      id: `${latestType}_recurrence`,
      confidence: Math.min(0.78, 0.42 + sameType.length * 0.1),
      supports: sameType.map(event => event.id),
      contradicts: [],
      whatWouldChangeAssessment: 'A similar situation with a different sequence or outcome.',
    }] : [],
    riskLevel: safety.class === 'ordinary' ? 'ordinary' : safety.class,
    confidence: recent.length ? Math.min(0.78, 0.32 + recent.length * 0.07) : 0,
    evidenceRefs,
  };
}

function selectPolicy(state, route, event, safety) {
  if (safety.requiresOverride) {
    return {
      mode: 'safety',
      objective: 'להוריד עומס ולשמור על ביטחון לפני שמלמדים או מסבירים',
      strategy: 'תגובה קצרה, רגועה וצמודה למה שקורה עכשיו',
      avoid: 'הרצאות, איומים, עונשים גדולים או משא ומתן ברגע טעון',
      playbookId: 'safety_scope_v2',
      expectedSignals: ['immediate_safety_restored', 'human_support_contacted'],
      reviewWindow: 'immediate',
      reversibility: 'high',
      risk: safety.class,
      policyVersion: '2.0.0',
    };
  }
  if (route === 'big_picture') {
    return {
      mode: 'synthesis',
      objective: 'לחבר את הפרטים לתמונה פשוטה וברורה',
      strategy: 'לשקף מה חוזר, מה עובד ומה הצעד הבא',
      avoid: 'להציג נתונים או שמות פנימיים של המערכת',
      playbookId: 'longitudinal_review_v2',
      expectedSignals: ['focus_is_clear', 'next_observation_defined'],
      reviewWindow: 'next_relevant_event',
      reversibility: 'high',
      risk: 'low',
      policyVersion: '2.0.0',
    };
  }
  if (event?.outcome === 'improvement') {
    return {
      mode: 'strategist',
      objective: 'לחזק את מה שכבר התחיל לעבוד',
      strategy: 'לזהות מה בדיוק עזר ולבנות ממנו חזרה עקבית',
      avoid: 'לעבור מהר מדי לבעיה הבאה',
      playbookId: `${event.type}_reinforcement_v2`,
      expectedSignals: ['strategy_repeated', 'improvement_repeats'],
      reviewWindow: 'next_3_events',
      reversibility: 'high',
      risk: 'low',
      policyVersion: '2.0.0',
    };
  }
  if (route === 'event' || route === 'action_plan') {
    return {
      mode: 'coach',
      objective: 'לתת כיוון מעשי בלי לאבד חמימות',
      strategy: 'שיקוף קצר ואז צעד אחד שאפשר לנסות',
      avoid: 'ניתוח ארוך מדי או יותר מדי הוראות בבת אחת',
      playbookId: event?.type ? `${event.type}_v2` : 'general_coaching_v2',
      expectedSignals: ['lower_escalation', 'clearer_next_step'],
      reviewWindow: 'next_relevant_event',
      reversibility: 'high',
      risk: 'low',
      policyVersion: '2.0.0',
    };
  }
  return {
    mode: 'listener',
    objective: 'להבין את ההקשר לפני שמנתחים',
    strategy: 'שאלה אחת קצרה וממוקדת',
    avoid: 'לקפוץ למסקנות או להמציא פרטים',
    playbookId: 'clarify_v2',
    expectedSignals: ['material_unknown_resolved'],
    reviewWindow: 'next_turn',
    reversibility: 'high',
    risk: 'low',
    policyVersion: '2.0.0',
  };
}

function mergeProfile(existing, person, lang, concern, sourceMessageId) {
  const old = existing || {};
  return {
    name: person.name,
    role: old.role && old.role !== 'unknown' ? old.role : person.role,
    confidence: Math.max(old.confidence || 0, person.confidence || 0),
    status: old.status || 'provisional',
    age: person.age ?? old.age ?? null,
    challenges: unique([...(old.challenges || []), concern?.label]).slice(0, 8),
    strengths: old.strengths || [],
    triggers: unique([...(old.triggers || []), concern?.label]).slice(0, 8),
    whatWorks: old.whatWorks || [],
    notes: old.notes || (lang === 'he' ? 'נוצר מתוך השיחה.' : 'Created from the conversation.'),
    sourceRefs: unique([...(old.sourceRefs || []), sourceMessageId]).slice(-12),
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

export function clearAdvisorCase() {
  localStorage.removeItem(CASE_KEY);
  return { ...EMPTY_CASE, profiles: {}, events: [], insights: [] };
}

export function serializeAdvisorCase(caseData) {
  return JSON.stringify({
    schemaVersion: '2.0-local-demo',
    exportedAt: new Date().toISOString(),
    case: caseData,
  }, null, 2);
}

function createResponseContract(route) {
  const contracts = {
    greeting: { advisorDepth: 'none', memoryScope: 'none', maxClarifyingQuestions: 1, empathyFirst: true, showBigPicture: false, personaMode: 'listener', avatarPresence: 'compact', responseLength: 'short' },
    open: { advisorDepth: 'none', memoryScope: 'light', maxClarifyingQuestions: 1, empathyFirst: true, showBigPicture: false, personaMode: 'listener', avatarPresence: 'compact', responseLength: 'short' },
    topic_intake: { advisorDepth: 'low', memoryScope: 'relevant_profile', maxClarifyingQuestions: 1, empathyFirst: true, showBigPicture: false, personaMode: 'listener', avatarPresence: 'compact', responseLength: 'short' },
    event_intake: { advisorDepth: 'low', memoryScope: 'working_only', maxClarifyingQuestions: 1, empathyFirst: true, showBigPicture: false, personaMode: 'listener', avatarPresence: 'compact', responseLength: 'short' },
    event: { advisorDepth: 'medium', memoryScope: 'relevant_case_slice', maxClarifyingQuestions: 1, empathyFirst: true, showBigPicture: false, personaMode: 'listener_to_analyst', avatarPresence: 'compact', responseLength: 'short' },
    empathic: { advisorDepth: 'low', memoryScope: 'relevant_case_slice', maxClarifyingQuestions: 1, empathyFirst: true, showBigPicture: false, personaMode: 'listener', avatarPresence: 'compact', responseLength: 'short' },
    action_plan: { advisorDepth: 'high', memoryScope: 'relevant_case_slice', maxClarifyingQuestions: 1, empathyFirst: true, showBigPicture: false, personaMode: 'coach', avatarPresence: 'full', responseLength: 'medium' },
    big_picture: { advisorDepth: 'high', memoryScope: 'full_case', maxClarifyingQuestions: 1, empathyFirst: true, showBigPicture: true, personaMode: 'analyst', avatarPresence: 'full', responseLength: 'medium' },
    simulation: { advisorDepth: 'special', memoryScope: 'relevant_case_slice', maxClarifyingQuestions: 1, empathyFirst: true, showBigPicture: false, personaMode: 'simulator', avatarPresence: 'full', responseLength: 'short' },
    safety: { advisorDepth: 'safety', memoryScope: 'minimum_required', maxClarifyingQuestions: 1, empathyFirst: true, showBigPicture: false, personaMode: 'safety', avatarPresence: 'compact', responseLength: 'short' },
  };
  return { turnClass: route, ...(contracts[route] || contracts.open) };
}

function createSynthesis({ route, event, state, policy, safety }) {
  if (['greeting', 'open', 'topic_intake', 'event_intake'].includes(route)) return null;
  const leadingHypothesis = state.hypotheses?.[0] || null;
  return {
    advisorMode: policy.mode,
    recognition: event ? 'Respond directly to the reported event.' : 'Respond to the user request using only relevant case context.',
    leadingPattern: leadingHypothesis?.id || null,
    alternatives: [],
    confidence: leadingHypothesis?.confidence || state.confidence || 0,
    evidenceRefs: leadingHypothesis?.supports || state.evidenceRefs || [],
    objective: policy.objective,
    recommendedFocus: policy.strategy,
    nextAction: policy.mode === 'listener' ? null : policy.strategy,
    whatToObserve: policy.expectedSignals?.[0] || null,
    uncertainty: leadingHypothesis ? null : 'Evidence is still limited; avoid presenting a pattern as established.',
    safetyClass: safety.class,
  };
}

function storeEligibleInsight(caseData, synthesis) {
  if (!synthesis?.leadingPattern || synthesis.evidenceRefs.length < 2) return caseData;
  const signature = `${synthesis.leadingPattern}:${synthesis.evidenceRefs.join(',')}`;
  if ((caseData.insights || []).some(insight => insight.signature === signature)) return caseData;
  return {
    ...caseData,
    insights: [...(caseData.insights || []), {
      id: newId('i_'),
      signature,
      claimType: 'system_inference',
      leadingPattern: synthesis.leadingPattern,
      confidence: synthesis.confidence,
      supportingRefs: synthesis.evidenceRefs,
      alternatives: synthesis.alternatives,
      recommendedFocus: synthesis.recommendedFocus,
      status: 'active',
      createdAt: new Date().toISOString(),
    }].slice(-40),
  };
}

export function prepareAdvisorTurn({ message, caseData, lang, persona, conversation = [] }) {
  const sourceMessageId = newId('m_');
  const concern = detectConcern(message, lang);
  const people = extractPeople(message, conversation);
  const safety = assessSafety(message);
  const extractedEvent = extractEvent(message, sourceMessageId);
  const eventDraft = extractedEvent || (safety.requiresOverride ? {
    id: newId('e_'),
    raw: message,
    type: 'safety_signal',
    trigger: null,
    outcome: 'escalation',
    date: new Date().toISOString().slice(0, 10),
    facts: [message],
    interpretations: [],
    alternatives: [],
    confidence: 0.9,
    status: 'provisional',
    sourceRefs: [sourceMessageId],
    safetyFlags: [safety.class],
  } : null);
  const contextSufficient = hasSufficientEventContext(message, eventDraft, people);
  const route = routeMessage(message, eventDraft, contextSufficient, safety, people);
  let next = {
    ...EMPTY_CASE,
    ...caseData,
    profiles: { ...(caseData.profiles || {}) },
    events: [...(caseData.events || [])],
    insights: [...(caseData.insights || [])],
  };

  let activeProfileId = next.activeProfileId;
  for (const person of people) {
    const id = profileId(person.name);
    next.profiles[id] = mergeProfile(next.profiles[id], person, lang, concern, sourceMessageId);
    activeProfileId = id;
  }

  const event = eventDraft && (contextSufficient || safety.requiresOverride)
    ? { ...eventDraft, safetyFlags: safety.requiresOverride ? [safety.class] : [] }
    : null;
  if (event) next.events = [...next.events, event].slice(-60);
  if (activeProfileId) next.activeProfileId = activeProfileId;
  if (concern || people.length > 0) {
    next.activeFocus = {
      id: concern?.id || 'person_context',
      label: concern?.label || people[0]?.name,
      profileId: activeProfileId || null,
      updatedAt: new Date().toISOString(),
    };
  }

  const state = computeState(next.events, safety);
  const policy = selectPolicy(state, route, eventDraft, safety);
  const responseContract = createResponseContract(route);
  const synthesis = createSynthesis({ route, event: eventDraft, state, policy, safety });
  if (route === 'big_picture' || state.hypotheses?.[0]?.supports?.length >= 3) {
    next = storeEligibleInsight(next, synthesis);
  }
  const activeProfile = next.activeProfileId ? next.profiles[next.activeProfileId] : null;

  const system = buildSystemPrompt({ lang, persona, caseData: next, route, event: eventDraft, state, policy, activeProfile, responseContract, synthesis, safety, contextSufficient });
  return { caseData: next, route, event, eventCommitted: Boolean(event), state, policy, responseContract, synthesis, safety, contextSufficient, system };
}

function buildSystemPrompt({ lang, persona, caseData, route, event, policy, activeProfile, responseContract, synthesis, safety, contextSufficient }) {
  const he = lang === 'he';
  const name = persona ? (he ? persona.name : persona.nameEn) : (he ? 'מאיה' : 'Maya');
  const profiles = Object.values(caseData.profiles || {});
  const recentEvents = (caseData.events || []).slice(-5);
  const focus = caseData.activeFocus;

  if (he) {
    return `את ${name}, יועצת הורית והתנהגותית מתמשכת. את מדברת בעברית טבעית, חמה וישירה, כמו יועצת אנושית שמכירה את התיק אבל לא נשמעת כמו מערכת.

העיקרון שלך: קודם אנושי, אחר כך מתודולוגי. אל תחשפי שמות פנימיים כמו מצב, מנוע, מדיניות, סינתזה או פרופיל. אל תוסיפי עובדות, אבחנות או מניעים שאינם מופיעים בהקשר. אל תציגי כותרות, markdown או רשימות. ברירת המחדל היא 1 עד 3 משפטים קצרים. הרחיבי רק אם חוזה התגובה מבקש ניתוח, תוכנית או סימולציה. שאלי לכל היותר שאלה אחת.

הנחיית תגובה שקטה: ${responseGuideHe(route)}
חוזה תגובה פנימי: ${JSON.stringify(responseContract)}
האדם שבמוקד: ${activeProfile ? `${activeProfile.name}, ${activeProfile.role || 'לא ידוע'}` : 'לא ידוע עדיין'}
המוקד הפעיל: ${focus?.label || 'עדיין מתברר'}
אירוע נוכחי: ${event ? `${event.raw} | כיוון: ${event.type} | תוצאה: ${event.outcome} | מספיק להחלטה: ${contextSufficient}` : 'אין אירוע ברור בהודעה הזאת'}
כיוון ייעוצי פנימי: מטרה - ${policy.objective}; דרך - ${policy.strategy}; להימנע מ - ${policy.avoid}
סינתזה פנימית: ${synthesis ? JSON.stringify(synthesis) : 'לא נדרשת בשלב הזה'}
בטיחות: ${safety.class}. ${safety.requiresOverride ? 'עצרי ייעוץ רגיל, תני צעד בטיחותי מיידי והפניה לעזרה אנושית מתאימה בלי לקבוע אבחנה או אשמה.' : 'אין אות בטיחות מפורש בהודעה.'}
תמונת תיק קצרה: ${recentEvents.length ? recentEvents.map(item => `${item.type}/${item.outcome}: ${item.raw}`).join(' | ') : 'עדיין אין מספיק היסטוריה'}
פרופילים מוכרים: ${profiles.length ? profiles.map(item => `${item.name}: ${(item.challenges || []).join(', ') || 'אין עדיין מספיק מידע'}`).join(' | ') : 'אין עדיין פרופילים'}

חשוב: השתמשי בהקשר הזה רק כדי להישמע רציפה וחכמה. אל תדווחי עליו כנתונים.`;
  }

  return `You are ${name}, a continuous parenting and behavioral advisor. Speak naturally, warmly, and directly, like a human advisor who knows the case without sounding like a system.

Principle: human first, method second. Do not reveal internal labels such as mode, engine, policy, synthesis, or profile. Do not add facts, diagnoses, or motives that are absent from the supplied context. No headings, markdown, or bullet lists. Default to 1 to 3 short sentences and expand only when the response contract asks for analysis, planning, or simulation. Ask at most one question.

Quiet response guide: ${responseGuideEn(route)}
Internal response contract: ${JSON.stringify(responseContract)}
Active person: ${activeProfile ? `${activeProfile.name}, ${activeProfile.role || 'unknown'}` : 'not known yet'}
Active focus: ${focus?.label || 'still forming'}
Current event: ${event ? `${event.raw} | direction: ${event.type} | outcome: ${event.outcome} | sufficient for a decision: ${contextSufficient}` : 'no clear event in this message'}
Internal advisory direction: objective - ${policy.objective}; strategy - ${policy.strategy}; avoid - ${policy.avoid}
Internal synthesis: ${synthesis ? JSON.stringify(synthesis) : 'not required for this turn'}
Safety: ${safety.class}. ${safety.requiresOverride ? 'Stop ordinary coaching and give an immediate safety-oriented next action and appropriate human escalation without asserting diagnosis or blame.' : 'No explicit safety signal in this message.'}
Short case picture: ${recentEvents.length ? recentEvents.map(item => `${item.type}/${item.outcome}: ${item.raw}`).join(' | ') : 'not enough history yet'}
Known profiles: ${profiles.length ? profiles.map(item => `${item.name}: ${(item.challenges || []).join(', ') || 'limited information'}`).join(' | ') : 'none yet'}

Use this context only to sound continuous and intelligent. Do not report it as data.`;
}

function responseGuideHe(route) {
  const map = {
    greeting: 'זו רק ברכה. עני קצר וחם, והזמיני בעדינות לספר במה להתמקד.',
    topic_intake: 'המשתמש מסמן אדם או נושא. הכירי בזה ושאלי שאלה אחת שמקדמת הבנה, לא שאלה כללית מדי.',
    event_intake: 'זה דיווח חלקי על אירוע. תני תיקוף קצר ושאלי רק מה היה הרגע הראשון שבו התחיל להידרדר. אל תציגי עדיין דפוס או המלצה.',
    event: 'זה דיווח על אירוע. תני שיקוף קצר, חברי בעדינות לכיוון אפשרי, ושאלי רק פרט חסר אחד אם צריך.',
    action_plan: 'המשתמש מבקש כיוון. תני צעד אחד ברור או ניסוח קצר.',
    big_picture: 'המשתמש מבקש תמונה כוללת. סכמי בעדינות מה נראה שחוזר ומה הפוקוס הבא.',
    empathic: 'יש עומס רגשי. קודם תיקוף רגשי, אחר כך שאלה אחת עדינה או צעד קטן.',
    simulation: 'הזמיני לתרגול טבעי וקצר.',
    safety: 'זהו אות בטיחות. השתמשי בשפה רגועה וישירה, תני פעולה בטוחה מיידית והפניה לעזרה אנושית מתאימה. אל תמשיכי באימון רגיל.',
    open: 'פתיחה כללית. אל תנתחי. שאלי שאלה אחת מזמינה.',
  };
  return map[route] || map.open;
}

function responseGuideEn(route) {
  const map = {
    greeting: 'This is only a greeting. Reply briefly and warmly, then invite focus.',
    topic_intake: 'The user is marking a person or topic. Acknowledge it and ask one useful next question.',
    event_intake: 'This is an incomplete event report. Briefly acknowledge it and ask only for the first moment when it began to shift. Do not present a pattern or recommendation yet.',
    event: 'This is an event report. Reflect briefly, connect gently to a possible direction, and ask only one missing detail if needed.',
    action_plan: 'The user wants direction. Give one clear next step or one short script.',
    big_picture: 'The user wants the bigger picture. Summarize what seems to repeat and the next focus.',
    empathic: 'The user sounds emotionally loaded. Validate first, then one gentle question or small step.',
    simulation: 'Invite a short natural practice.',
    safety: 'This is a safety signal. Use calm direct language, give an immediate safe next action and appropriate human escalation. Do not continue ordinary coaching.',
    open: 'Open start. Do not analyze. Ask one inviting question.',
  };
  return map[route] || map.open;
}
