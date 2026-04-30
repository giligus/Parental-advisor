// Session memory + Advisor synthesis layer
// Phase 2: Progress tracking, weekly reviews, big picture insights

const STORAGE_KEY = 'advisor_case_data';
const SESSION_KEY = 'advisor_sessions';

// ── Persistent storage ──────────────────────────────
export function saveCase(caseData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(caseData));
  } catch (e) { console.warn('Storage save failed:', e); }
}

export function loadCase() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearCase() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SESSION_KEY);
}

// ── Session tracking ────────────────────────────────
export function saveSession(sessionSummary) {
  try {
    const sessions = JSON.parse(localStorage.getItem(SESSION_KEY) || '[]');
    sessions.push({
      ...sessionSummary,
      date: new Date().toISOString(),
    });
    // Keep last 30 sessions
    const trimmed = sessions.slice(-30);
    localStorage.setItem(SESSION_KEY, JSON.stringify(trimmed));
  } catch (e) { console.warn('Session save failed:', e); }
}

export function getSessions() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || '[]');
  } catch { return []; }
}

// ── Progress computation ────────────────────────────
export function computeProgress(events) {
  if (events.length < 2) return null;
  
  const midpoint = Math.floor(events.length / 2);
  const firstHalf = events.slice(0, midpoint);
  const secondHalf = events.slice(midpoint);
  
  const escFirst = firstHalf.filter(e => e.outcome === 'escalation').length / firstHalf.length;
  const escSecond = secondHalf.filter(e => e.outcome === 'escalation').length / secondHalf.length;
  const impFirst = firstHalf.filter(e => e.outcome === 'improvement').length / firstHalf.length;
  const impSecond = secondHalf.filter(e => e.outcome === 'improvement').length / secondHalf.length;
  
  const escalationTrend = escSecond - escFirst; // negative = improving
  const improvementTrend = impSecond - impFirst; // positive = improving
  
  let direction;
  if (escalationTrend < -0.1 || improvementTrend > 0.1) direction = 'improving';
  else if (escalationTrend > 0.1 || improvementTrend < -0.1) direction = 'declining';
  else direction = 'stable';
  
  return {
    total: events.length,
    escalations: events.filter(e => e.outcome === 'escalation').length,
    improvements: events.filter(e => e.outcome === 'improvement').length,
    neutral: events.filter(e => e.outcome === 'neutral').length,
    direction,
    escalationTrend,
    improvementTrend,
    recentTypes: [...new Set(events.slice(-5).map(e => e.type).filter(t => t !== 'general'))],
  };
}

// ── Build weekly review context for LLM ─────────────
export function buildWeeklyReviewPrompt(lang, caseData, state, progress) {
  const he = lang === 'he';
  
  const profileSummary = Object.entries(caseData.profiles)
    .map(([, p]) => `${p.name}: ${(p.challenges || []).join(', ')} / ${(p.whatWorks || []).join(', ')}`)
    .join('\n');
  
  const eventSummary = caseData.events.slice(-10)
    .map(e => `${e.date}: ${e.type} → ${e.outcome}`)
    .join('\n');
  
  return he
    ? `אתה יועץ התנהגותי שעושה סיכום שבועי. דבר בעברית טבעית וחמה. 
    
תן תמונת מצב כוללת — לא רשימה, אלא 3-5 משפטים שמתארים מה קורה, מה השתנה, ומה הכיוון לשבוע הקרוב.
תתחיל ב"אני רוצה לעצור רגע ולשקף..." או משפט דומה.
אל תציג מספרים גולמיים. תדבר כמו יועץ שמכיר את המשפחה.
תסיים עם המלצה אחת ברורה לשבוע הקרוב.
ללא כותרות, רשימות, או markdown.

נתוני רקע:
פרופילים: ${profileSummary}
אירועים אחרונים: ${eventSummary}
מגמה: ${progress?.direction || 'לא מספיק נתונים'}
הסלמות: ${progress?.escalations || 0}, שיפורים: ${progress?.improvements || 0}
סוגי אירועים חוזרים: ${progress?.recentTypes?.join(', ') || 'לא זוהו'}`
    : `You are a behavioral advisor giving a weekly review. Speak naturally.

Give an overall picture — not a list, but 3-5 sentences describing what's happening, what changed, and the direction for next week.
Start with "I want to pause and reflect..." or similar.
Don't show raw numbers. Speak like an advisor who knows the family.
End with one clear recommendation for next week.
No headers, lists, or markdown.

Background data:
Profiles: ${profileSummary}
Recent events: ${eventSummary}
Trend: ${progress?.direction || 'not enough data'}
Escalations: ${progress?.escalations || 0}, Improvements: ${progress?.improvements || 0}
Recurring types: ${progress?.recentTypes?.join(', ') || 'none identified'}`;
}

// ── Advisor presence rules ──────────────────────────
// Returns whether the avatar should show prominently
export function shouldShowAdvisorPresence(caseData, state, lastEvent) {
  // Weekly summary moment
  if (caseData.events.length > 0 && caseData.events.length % 7 === 0) return 'weekly_review';
  
  // Significant pattern detected
  const recentEsc = caseData.events.slice(-4).filter(e => e.outcome === 'escalation').length;
  if (recentEsc >= 3) return 'pattern_alert';
  
  // Progress milestone
  const recentImp = caseData.events.slice(-4).filter(e => e.outcome === 'improvement').length;
  if (recentImp >= 3) return 'progress_celebration';
  
  // First event with a new trigger type
  if (lastEvent) {
    const previousTypes = new Set(caseData.events.slice(0, -1).map(e => e.type));
    if (!previousTypes.has(lastEvent.type) && lastEvent.type !== 'general') return 'new_pattern';
  }
  
  return null;
}
