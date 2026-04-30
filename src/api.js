// Server API helper — Anthropic key stays on the backend.
const API_URL = '/api/chat';

async function callAPI(system, messages) {
  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        max_tokens: 1024,
        system,
        messages,
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      console.error('API error:', d?.error || r.statusText);
      return null;
    }
    return d.text || null;
  } catch (e) {
    console.error('API error:', e);
    return null;
  }
}

// Build system prompt with engine context baked in
export function buildSystemPrompt(lang, caseData, state, policy, extra) {
  const he = lang === 'he';

  const base = he
    ? `אתה יועץ התנהגותי מומחה. אתה מדבר בעברית טבעית, חמה וישירה — כמו יועץ אמיתי.

## סגנון
- חם, ישיר, אמפתי, מעשי. שפה יומיומית.
- אל תשתמש במונחים קליניים כמו "דפוס", "הסלמה", "ויסות" — דבר בשפה רגילה
- אל תציג מספרים או אחוזים
- בלי כותרות, כוכביות, רשימות, bold, markdown — רק טקסט רגיל
- 2-6 משפטים. פסקאות קצרות.
- שאלה אחת בסוף או צעד קטן אחד — לא שניהם
- כשנותנים תסריט: משפט אחד טבעי בגרשיים
- תגוון את הפתיחות — לא תמיד "אני מבין"
- כשהמשתמש מספר על הצלחה: תשקף, תחזק, תראה שאתה שמח

## בניית פרופיל
כשהמשתמש מספר על אדם חדש (ילד, בן זוג, תלמיד) — שאל שאלות טבעיות כדי להבין:
- שם, גיל, תפקיד (ילד/הורה/בן זוג)
- מה מאתגר, מה עובד, מה מפעיל
- אל תעשה ראיון — תשלב את השאלות בשיחה טבעית

## הצעת תרגול
כשיש מספיק הקשר ונראה שהמשתמש מוכן — הצע תרגול בצורה טבעית:
"רוצים שנתרגל את הסיטואציה הזו? אני אשחק את [השם] ואתם תענו"
אל תכפה. תציע רק כשזה מתאים.`
    : `You are an expert behavioral advisor. Speak natural, warm English.

## Style
- Warm, direct, empathetic, practical. Everyday language.
- No clinical terms — speak naturally
- No numbers or percentages
- No headers, bullets, bold, markdown — just plain text
- 2-6 sentences. Short paragraphs.
- One question at the end OR one small step — not both
- Vary your openings

## Profile building
When user mentions a new person — ask natural questions to understand them.

## Practice suggestions
When context is sufficient — naturally suggest practicing the situation.`;

  const profiles = Object.entries(caseData.profiles);
  const profileStr = profiles.length > 0
    ? `\n${he ? 'פרופילים ידועים' : 'Known profiles'}:\n${profiles.map(([, p]) =>
        `${p.name} (${p.role}${p.age ? `, ${he ? 'בן' : 'age'} ${p.age}` : ''}): ${p.notes || (he ? 'עדיין לא מספיק מידע' : 'limited info')}`
      ).join('\n')}`
    : '';

  const engineCtx = caseData.events.length > 0
    ? `\n[${he ? 'הקשר מנוע — אל תציג, השתמש כרקע' : 'Engine context — background only'}]
${he ? 'אירועים' : 'Events'}: ${caseData.events.length}, ${he ? 'הסלמות' : 'escalations'}: ${caseData.events.filter(e => e.outcome === 'escalation').length}, ${he ? 'שיפורים' : 'improvements'}: ${caseData.events.filter(e => e.outcome === 'improvement').length}
${he ? 'מדיניות' : 'Policy'}: ${policy.obj} / ${policy.strat} / ${he ? 'להימנע' : 'avoid'}: ${policy.avoid}`
    : '';

  return base + profileStr + engineCtx + (extra || '');
}

// Greeting
export async function getGreeting(lang) {
  const sys = lang === 'he'
    ? 'אתה יועץ התנהגותי. פתח בברכה חמה בעברית. 2-3 משפטים. שאל מה מעסיק. לא מערכת, לא AI. בשפה חמה ובוגרת.'
    : 'You are a behavioral advisor. Open with a warm greeting. 2-3 sentences. Ask what\'s on their mind.';
  const fallback = lang === 'he' ? 'שלום, שמח שאתם פה. ספרו לי — מה מעסיק אתכם?' : 'Hi! Glad you\'re here. What\'s on your mind?';
  return (await callAPI(sys, [{ role: 'user', content: lang === 'he' ? 'שלום' : 'Hello' }])) || fallback;
}

// Main advisor response
export async function getAdvisorResponse(systemPrompt, conversationHistory) {
  const fallback = 'ספרו לי עוד.';
  return (await callAPI(systemPrompt, conversationHistory)) || fallback;
}

// Profile extraction from conversation
export async function extractProfiles(recentMessages) {
  const sys = `Analyze this conversation and extract any person profiles mentioned. Return ONLY valid JSON, no other text. Format:
{"profiles": [{"name": "string", "role": "child|parent|partner|student|other", "age": null, "challenges": [], "strengths": [], "triggers": [], "whatWorks": [], "notes": ""}]}
If no profile info found, return {"profiles": []}. Only include profiles with at least a name.`;

  const content = recentMessages.map(x => `${x.role}: ${x.text}`).join('\n');
  const raw = await callAPI(sys, [{ role: 'user', content }]);

  if (!raw) return [];

  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return parsed.profiles || [];
  } catch {
    return [];
  }
}

// Simulation feedback
export async function getSimFeedback(lang, scenario, parentResponse) {
  const sys = lang === 'he'
    ? `אתה יועץ הורי בסימולציה. הסיטואציה: ${scenario.context}\nהילד אמר: "${scenario.child}"\nההורה ענה: "${parentResponse}"\nתן משוב חם וישיר. מה טוב, מה לשפר, דוגמה קצרה. 3-5 משפטים. עברית טבעית. ללא כותרות או markdown.`
    : `You're a parenting advisor in a simulation. Situation: ${scenario.context}\nChild said: "${scenario.child}"\nParent responded: "${parentResponse}"\nGive warm, direct feedback. What's good, what to improve, short example. 3-5 sentences. No headers or markdown.`;

  return (await callAPI(sys, [{ role: 'user', content: parentResponse }])) || (lang === 'he'
    ? 'ניסיון טוב! נסו לקצר את התגובה בפעם הבאה.'
    : 'Good try! Try keeping it shorter next time.');
}

// Weekly review / big picture synthesis
export async function getWeeklyReview(systemPrompt) {
  const fallback = 'עדיין אין מספיק מידע לסיכום שבועי. ספרו לי עוד על מה שקורה.';
  return (await callAPI(systemPrompt, [{ role: 'user', content: 'תן לי תמונה כוללת וסיכום' }])) || fallback;
}

// Simulation intro
export async function getSimIntro(lang, scenario) {
  const sys = lang === 'he'
    ? `אתה יועץ הורי שמתחיל סימולציה. הצג את המצב בטבעיות, "שחק" את הילד, ובקש מההורה להגיב. 3 משפטים. עברית טבעית.`
    : `You're starting a parenting simulation. Present the situation naturally, "play" the child, ask the parent to respond. 3 sentences.`;

  const fallback = lang === 'he'
    ? `בואו נתרגל. ${scenario.context}\n\nהילד אומר: "${scenario.child}"\n\nמה אתם עונים?`
    : `Let's practice. ${scenario.context}\n\nThe child says: "${scenario.child}"\n\nWhat do you say?`;

  return (await callAPI(sys, [{ role: 'user', content: `${scenario.context}\n"${scenario.child}"` }])) || fallback;
}
