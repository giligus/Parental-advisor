// api.js — upgraded system prompt + conversation quality fixes
// Keeps the server-side /api/chat proxy (correct production architecture)

const API_URL = '/api/chat';
let lastApiError = null;
let lastApiCategory = null;

function looksHebrew(text) {
  return /[\u0590-\u05FF]/.test(text || '');
}

function friendlyApiFallback(langOrText) {
  const he = langOrText === 'he' || looksHebrew(langOrText);
  const cat = lastApiCategory || '';

  if (he) {
    if (cat === 'quota')   return 'יש כרגע בעיית מכסה או חיוב במפתח ה-API. בדקו ב-Railway שהמפתח נכון ושיש קרדיט פעיל.';
    if (cat === 'auth')    return 'מפתח ה-API שמוגדר בשרת אינו תקין. בדקו את ה-ANTHROPIC_API_KEY / OPENAI_API_KEY ב-Railway.';
    if (cat === 'timeout') return 'השרת לקח יותר מדי זמן להגיב. נסו שוב בעוד רגע.';
    return 'יש כרגע בעיה בחיבור למנוע השפה. בדקו את משתני הסביבה ב-Railway ונסו שוב.';
  }
  if (cat === 'quota')   return 'The API key is hitting a quota or billing limit. Check Railway variables and provider billing.';
  if (cat === 'auth')    return 'The API key configured on the server is invalid. Check ANTHROPIC_API_KEY / OPENAI_API_KEY in Railway.';
  if (cat === 'timeout') return 'The server took too long to respond. Please try again in a moment.';
  return 'There is a problem connecting to the language provider. Check Railway environment variables.';
}

async function callAPI(system, messages) {
  try {
    lastApiError = null;
    lastApiCategory = null;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_tokens: 1024, system, messages }),
    });

    let data = {};
    try { data = await response.json(); } catch { data = {}; }

    if (!response.ok) {
      lastApiError = data?.error || response.statusText || `HTTP ${response.status}`;
      lastApiCategory = data?.category || null;
      console.error('API error:', lastApiError, '| category:', lastApiCategory, '| provider:', data?.provider);
      return null;
    }
    return data.text || null;
  } catch (error) {
    lastApiError = error?.message || String(error);
    lastApiCategory = 'error';
    console.error('API fetch error:', error);
    return null;
  }
}

// ── Conversation history sanitizer ───────────────────
// FIX #7: API requires first message = user, no consecutive same-role turns
export function buildCleanHistory(msgs) {
  // Filter out error/system messages
  const filtered = (msgs || [])
    .filter(x => !x.isErr && !x.isSystem)
    .map(x => ({ role: x.role === 'user' ? 'user' : 'assistant', content: x.text || x.content || '' }));

  // Merge consecutive same-role messages
  const merged = [];
  for (const h of filtered) {
    if (merged.length && merged[merged.length - 1].role === h.role) {
      merged[merged.length - 1].content += ' ' + h.content;
    } else {
      merged.push({ ...h });
    }
  }

  // Must start with user — API hard requirement
  while (merged.length > 0 && merged[0].role === 'assistant') merged.shift();

  return merged.slice(-12);
}

// ── System prompt builder — UPGRADED ─────────────────
export function buildSystemPrompt(lang, caseData, state, policy, extra = '') {
  const he = lang === 'he';

  // FIX #1 + #3: Removed raw float exposure (childReg=0.5 etc) and abstract policy labels
  // FIX #4: Added "vary openings" instruction
  // FIX #5: Explicitly forbid clinical terms
  const base = he
    ? `אתה יועץ הורי מומחה ואנושי. אתה מדבר בעברית טבעית, חמה וישירה — כמו חבר טוב שמבין בחינוך וילדים.

חוקים קריטיים — חובה לשמור עליהם בכל תשובה:
- דבר בפסקאות קצרות וטבעיות. 2-5 משפטים בלבד. לא יותר.
- אסור לחלוטין: כותרות, רשימות עם מקפים או נקודות, bold, *, markdown מכל סוג.
- אסור: מונחים קליניים כמו "דפוס", "הסלמה", "ויסות", "מצב" — דבר בשפה רגילה של אנשים.
- אסור: מספרים, אחוזים, סטטיסטיקות, נתונים טכניים.
- שפה חמה, ישירה ומעשית — לא אקדמית ולא רשמית.
- תגוון פתיחות — לא תמיד "אני מבין" או "זה קשה". חפש ביטויים שונים בכל תשובה.
- שאלה אחת בסוף, או הצעה קונקרטית אחת — לא שניהם ביחד.
- כשמציע משפט שההורה יגיד — משפט אחד טבעי בגרשיים, לא רשימה.
- כשמישהו מתאר הצלחה — תשקף, תחגוג, תחזק. זה חשוב.
- אם המשתמש במצוקה — קודם תקף רגשית, רק אחר כך הצע כיוון.
- כשמוזכר ילד או אדם חדש — שאל שאלה טבעית אחת כדי להכיר אותו טוב יותר.`
    : `You are an expert, human parenting advisor. You speak natural, warm English — like a knowledgeable friend.

Critical rules — must follow in every response:
- Short natural paragraphs. 2-5 sentences only. No more.
- Never use: headers, bullet lists, bold, *, or any markdown.
- Never use clinical terms like "pattern", "escalation", "regulation", "dysregulation" — speak plainly.
- Never use: numbers, percentages, statistics, or technical data.
- Warm, direct, practical — not academic or formal.
- Vary your openings — don't always start with "I understand" or "That sounds hard."
- One question at the end, or one concrete suggestion — not both together.
- When giving a script phrase — one natural sentence in quotes, not a list.
- When someone describes a success — reflect it, celebrate it, reinforce it.
- When user is distressed — validate emotionally first, advise second.
- When a new person is mentioned — ask one natural question to understand them better.`;

  // FIX #2: State context rewritten as natural language, not raw numbers
  // Only inject when there are enough events to be meaningful
  const events = caseData?.events || [];
  const profiles = Object.values(caseData?.profiles || {});
  const escalations = events.filter(e => e.outcome === 'escalation').length;
  const improvements = events.filter(e => e.outcome === 'improvement').length;

  let contextText = '';
  if (events.length >= 2) {
    const trend = improvements > escalations ? (he ? 'מגמת שיפור' : 'improving trend')
                : escalations > improvements ? (he ? 'תקופה מאתגרת' : 'challenging period')
                : (he ? 'מצב יציב' : 'stable situation');

    const riskLevel = state?.risk === 'high' ? (he ? 'גבוהה' : 'high')
                    : state?.risk === 'medium' ? (he ? 'בינונית' : 'medium')
                    : (he ? 'נמוכה' : 'low');

    // FIX #3: Policy as natural guidance, not abstract labels
    const strategyHint = policy?.mode === 'safety'    ? (he ? 'דגש על הרגעה ובטיחות' : 'focus on calming and safety')
                       : policy?.mode === 'coach'     ? (he ? 'דגש על גבולות ברורים בצורה חמה' : 'focus on warm clear boundaries')
                       : policy?.mode === 'strategist' ? (he ? 'דגש על חיזוק מה שעובד' : 'focus on reinforcing what works')
                       : (he ? 'דגש על הקשבה והבנה' : 'focus on listening and understanding');

    contextText = he
      ? `\n\n[הקשר השיחה — השתמש כרקע, אל תציג ישירות]
מגמה כללית: ${trend}
רמת מורכבות: ${riskLevel}
כיוון מומלץ: ${strategyHint}
${policy?.avoid ? `כדאי להימנע מ: ${policy.avoid}` : ''}`
      : `\n\n[Conversation context — use as background, don't display directly]
Overall trend: ${trend}
Complexity level: ${riskLevel}
Recommended direction: ${strategyHint}
${policy?.avoid ? `Worth avoiding: ${policy.avoid}` : ''}`;
  }

  // Profile context — same as before but richer
  const profileText = profiles.length
    ? `\n\n${he ? 'אנשים ידועים בשיחה' : 'Known people in conversation'}:\n${profiles.map(p => {
        const age = p.age ? `, ${he ? 'גיל' : 'age'} ${p.age}` : '';
        const challenges = p.challenges?.length ? ` | ${he ? 'אתגרים' : 'challenges'}: ${p.challenges.join(', ')}` : '';
        const works = p.whatWorks?.length ? ` | ${he ? 'מה עובד' : 'what works'}: ${p.whatWorks.join(', ')}` : '';
        return `${p.name} (${p.role || 'other'}${age})${challenges}${works}`;
      }).join('\n')}`
    : '';

  return `${base}${profileText}${contextText}${extra || ''}`;
}

// ── API call wrappers ─────────────────────────────────

export async function getGreeting(lang, personaName) {
  const he = lang === 'he';
  const name = personaName || (he ? 'היועץ' : 'the advisor');

  // FIX #6: Greeting now includes persona name and character
  const system = he
    ? `אתה ${name}, יועץ הורי מומחה. פתח בברכה חמה ואנושית בעברית. 2-3 משפטים. שאל בעדינות מה מעסיק אותם היום. ללא markdown. ללא כותרות. שפה יומיומית לגמרי.`
    : `You are ${name}, an expert parenting advisor. Open with a warm human greeting. 2-3 sentences. Gently ask what's on their mind today. No markdown. Plain conversational language.`;

  const fallback = he
    ? `שלום, שמחה שאתם פה. ספרו לי — מה עובר עליכם היום?`
    : `Hi, glad you're here. Tell me — what's been on your mind today?`;

  return (await callAPI(system, [{ role: 'user', content: he ? 'שלום' : 'Hello' }])) || fallback;
}

export async function getAdvisorResponse(systemPrompt, conversationHistory) {
  // FIX #7: History must be sanitized before calling
  // If raw msgs array passed, sanitize; if already clean array, use as-is
  const cleanHistory = Array.isArray(conversationHistory) && conversationHistory[0]?.text
    ? buildCleanHistory(conversationHistory)
    : conversationHistory;

  const response = await callAPI(systemPrompt, cleanHistory);
  if (response) return response;
  return lastApiError ? friendlyApiFallback(systemPrompt) : (looksHebrew(systemPrompt) ? 'ספרו לי עוד.' : 'Tell me more.');
}

export async function extractProfiles(recentMessages) {
  const system = `Analyze this conversation and extract person profiles. Return ONLY valid JSON, no markdown.
Format: {"profiles":[{"name":"string","role":"child|parent|partner|student|other","age":null,"challenges":[],"strengths":[],"triggers":[],"whatWorks":[],"notes":""}]}
If no profile info is found, return {"profiles":[]}. Only include profiles with at least a name.`;

  const content = recentMessages
    .filter(m => !m.isErr && !m.isSystem)
    .map(m => `${m.role}: ${m.text}`)
    .join('\n');

  const raw = await callAPI(system, [{ role: 'user', content }]);
  if (!raw) return [];
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim()).profiles || [];
  } catch { return []; }
}

export async function getSimFeedback(lang, scenario, parentResponse) {
  const he = lang === 'he';
  const system = he
    ? `אתה יועץ הורי בסימולציה. הסיטואציה: ${scenario.context}\nהילד אמר: "${scenario.child}"\nההורה ענה: "${parentResponse}"\nתן משוב חם וישיר: מה טוב, מה לשפר, ודוגמה קצרה. 3-5 משפטים. ללא כותרות, ללא markdown, שפה יומיומית.`
    : `You are a parenting advisor in a simulation. Situation: ${scenario.context}\nChild said: "${scenario.child}"\nParent responded: "${parentResponse}"\nGive warm direct feedback: what is good, what to improve, one short example. 3-5 sentences. No headers, no markdown.`;

  const response = await callAPI(system, [{ role: 'user', content: parentResponse }]);
  if (response) return response;
  if (lastApiError) return friendlyApiFallback(lang);
  return he
    ? 'ניסיון טוב. בפעם הבאה נסו לקצר את התגובה ולשמור על משפט גבול אחד ברור.'
    : 'Good try. Next time, keep it shorter and use one clear boundary sentence.';
}

export async function getWeeklyReview(systemPrompt) {
  const response = await callAPI(systemPrompt, [{ role: 'user', content: 'Give me the big picture and weekly review.' }]);
  if (response) return response;
  return lastApiError
    ? friendlyApiFallback(systemPrompt)
    : (looksHebrew(systemPrompt) ? 'עדיין אין מספיק מידע לסיכום שבועי.' : 'Not enough data for a weekly review yet.');
}

export async function getSimIntro(lang, scenario) {
  const he = lang === 'he';
  const system = he
    ? `אתה יועץ הורי שמתחיל סימולציה. הצג את המצב בטבעיות, שחק את הילד, ובקש מההורה להגיב. 3 משפטים. ללא markdown.`
    : 'You are starting a parenting simulation. Present the situation naturally, play the child, ask the parent to respond. 3 sentences. No markdown.';

  const fallback = he
    ? `בואו נתרגל. ${scenario.context}\n\nהילד אומר: "${scenario.child}"\n\nמה אתם עונים?`
    : `Let's practice. ${scenario.context}\n\nThe child says: "${scenario.child}"\n\nWhat do you say?`;

  const response = await callAPI(system, [{ role: 'user', content: `${scenario.context}\n"${scenario.child}"` }]);
  if (response) return response;
  return lastApiError ? friendlyApiFallback(lang) : fallback;
}
