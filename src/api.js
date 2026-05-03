const API_URL = '/api/chat';
let lastApiError = null;

function looksHebrew(text) {
  return /[\u0590-\u05FF]/.test(text || '');
}

function friendlyApiFallback(langOrText) {
  const he = langOrText === 'he' || looksHebrew(langOrText);
  const quota = /quota|billing|429/i.test(lastApiError || '');

  if (he) {
    return quota
      ? 'יש כרגע בעיית מכסה או חיוב במפתח ה-API שמוגדר בשרת, ולכן אני לא מצליח לקבל תשובה מהמנוע. אפשר לבדוק ב-Railway שהמפתח נכון, שיש Billing או קרדיט פעיל אצל הספק, ואז לנסות שוב.'
      : 'יש כרגע בעיה בחיבור למנוע השפה. אני עדיין כאן, אבל התשובה החכמה מהשרת לא זמינה כרגע. בדקו את משתני הסביבה ב-Railway ואז נסו שוב.';
  }

  return quota
    ? 'The server API key is currently hitting a quota or billing limit, so I cannot get a model response. Check the Railway variables and the provider billing or credits, then try again.'
    : 'There is currently a problem connecting to the language provider. Check the Railway environment variables, then try again.';
}

async function callAPI(system, messages) {
  try {
    lastApiError = null;
    const response = await fetch(API_URL, {
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

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      lastApiError = data?.error || response.statusText || `HTTP ${response.status}`;
      console.error('API error:', lastApiError);
      return null;
    }

    return data.text || null;
  } catch (error) {
    lastApiError = error?.message || String(error);
    console.error('API error:', error);
    return null;
  }
}

export function buildSystemPrompt(lang, caseData, state, policy, extra = '') {
  const he = lang === 'he';

  const base = he
    ? `אתה יועץ התנהגותי מתמשך. אתה מדבר בעברית טבעית, רגועה, חמה וישירה, כמו יועץ שמכיר את התיק.

כללי סגנון:
- קודם אנושי, אחר כך מתודולוגי.
- אל תחשוף שמות פנימיים כמו State Engine, Analyst Mode או Listener Mode.
- אל תשתמש בכותרות, markdown, אחוזים או שפה מערכתית.
- ענה ב-2 עד 6 משפטים קצרים.
- אם חסר מידע, שאל שאלה קצרה אחת בלבד.
- אם יש אירוע ברור, חבר אותו בעדינות למה שכבר ידוע.
- אם המשתמש במצוקה, קודם תקף רגשית ורק אחר כך הצע כיוון.
- כשאתה מציע ניסוח, תן משפט אחד שאפשר לומר בפועל.`
    : `You are a continuous behavioral advisor. Speak in natural, calm, warm English, like an advisor who knows the case.

Style rules:
- Human first, methodological second.
- Do not expose internal labels like State Engine, Analyst Mode, or Listener Mode.
- Do not use headers, markdown, percentages, or system language.
- Reply in 2 to 6 short sentences.
- If information is missing, ask one short question only.
- If there is a clear event, gently connect it to known context.
- If the user is distressed, validate emotionally before advising.
- When giving a script, give one practical sentence they can say.`;

  const profiles = Object.values(caseData.profiles || {});
  const profileText = profiles.length
    ? `\n\n${he ? 'פרופילים ידועים' : 'Known profiles'}:\n${profiles.map(profile => {
        const age = profile.age ? `, ${he ? 'גיל' : 'age'} ${profile.age}` : '';
        return `${profile.name} (${profile.role || 'other'}${age}): ${profile.notes || (he ? 'אין עדיין מספיק מידע' : 'limited info')}`;
      }).join('\n')}`
    : '';

  const eventText = (caseData.events || []).length
    ? `\n\n${he ? 'הקשר תיק פנימי, לא להציג כנתונים טכניים' : 'Internal case context, do not present technically'}:
${he ? 'אירועים' : 'Events'}: ${caseData.events.length}
${he ? 'הסלמות' : 'Escalations'}: ${caseData.events.filter(event => event.outcome === 'escalation').length}
${he ? 'שיפורים' : 'Improvements'}: ${caseData.events.filter(event => event.outcome === 'improvement').length}
${he ? 'מטרה' : 'Objective'}: ${policy?.obj || ''}
${he ? 'אסטרטגיה' : 'Strategy'}: ${policy?.strat || ''}
${he ? 'להימנע' : 'Avoid'}: ${policy?.avoid || ''}`
    : '';

  const stateText = state
    ? `\n\n${he ? 'מצב פנימי משוער' : 'Estimated internal state'}:
childReg=${state.childReg}, parentReg=${state.parentReg}, conflict=${state.conflict}, trust=${state.trust}, risk=${state.risk}`
    : '';

  const latestEvent = (caseData.events || []).slice(-1)[0];
  const latestEventText = latestEvent
    ? `\n\nLatest event, use this directly:
raw="${latestEvent.raw || ''}"
type=${latestEvent.type || 'general'}
trigger=${latestEvent.trigger || 'unknown'}
outcome=${latestEvent.outcome || 'neutral'}`
    : '';

  const playbookText = latestEvent?.type === 'screen' && latestEvent?.outcome === 'escalation'
    ? `

Screen transition playbook:
- Interpret this as a transition difficulty plus power-struggle risk, not only a screen problem.
- The objective is to de-escalate without giving up the boundary.
- Avoid long explanations, threats, punishment escalation, and negotiation after the boundary.
- Use clear and calm language, not harsh or blunt language.
- Recommended script in Hebrew: "אני רואה שקשה לך לעצור. המסך נסגר עכשיו. אתה יכול לכבות לבד או שאני אכבה."
- After calm returns, recommend a short repair conversation, not a long explanation during screaming.
- In the response, include the pattern and one practical next step.`
    : '';

  const responseGuardrails = `

Response guardrails:
- If the latest user message reports an event, answer that event directly and use its concrete details.
- Do not ask "what is on your mind" or "what happened?" after an event was already reported.
- If one useful detail is missing, ask for that one detail in context.
- Do not make the whole answer a question when a playbook applies.
- Do not invent names, previous topics, history, or hidden facts.
- Prefer a useful advisor response: recognition, pattern, objective, and one practical next sentence.`;

  return `${base}${responseGuardrails}${profileText}${eventText}${stateText}${latestEventText}${playbookText}${extra || ''}`;
}

export async function getGreeting(lang) {
  const he = lang === 'he';
  const system = he
    ? 'אתה יועץ התנהגותי. פתח בברכה חמה בעברית טבעית. 2-3 משפטים. שאל בעדינות מה מעסיק אותם.'
    : "You are a behavioral advisor. Open with a warm greeting. 2-3 sentences. Gently ask what's on their mind.";
  const fallback = he
    ? 'שלום, שמח שאתם פה. תרצו לספר מה קרה היום, או להמשיך מהנושא האחרון?'
    : "Hi, glad you're here. Would you like to tell me what happened today, or continue from the last topic?";

  return (await callAPI(system, [{ role: 'user', content: he ? 'שלום' : 'Hello' }])) || fallback;
}

export async function getAdvisorResponse(systemPrompt, conversationHistory) {
  const response = await callAPI(systemPrompt, conversationHistory);
  if (response) return response;
  return lastApiError ? friendlyApiFallback(systemPrompt) : 'ספרו לי עוד.';
}

export async function extractProfiles(recentMessages) {
  const system = `Analyze this conversation and extract person profiles. Return ONLY valid JSON, no markdown.
Format: {"profiles":[{"name":"string","role":"child|parent|partner|student|other","age":null,"challenges":[],"strengths":[],"triggers":[],"whatWorks":[],"notes":""}]}
If no profile info is found, return {"profiles":[]}. Only include profiles with at least a name.`;

  const content = recentMessages.map(item => `${item.role}: ${item.text}`).join('\n');
  const raw = await callAPI(system, [{ role: 'user', content }]);

  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return parsed.profiles || [];
  } catch {
    return [];
  }
}

export async function getSimFeedback(lang, scenario, parentResponse) {
  const he = lang === 'he';
  const system = he
    ? `אתה יועץ הורי בסימולציה. הסיטואציה: ${scenario.context}
הילד אמר: "${scenario.child}"
ההורה ענה: "${parentResponse}"
תן משוב חם וישיר: מה טוב, מה לשפר, ודוגמה קצרה. 3-5 משפטים. בלי כותרות או markdown.`
    : `You are a parenting advisor in a simulation. Situation: ${scenario.context}
Child said: "${scenario.child}"
Parent responded: "${parentResponse}"
Give warm, direct feedback: what is good, what to improve, and one short example. 3-5 sentences. No headers or markdown.`;

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
    : 'עדיין אין מספיק מידע לסיכום שבועי. ספרו לי עוד על מה שקורה.';
}

export async function getSimIntro(lang, scenario) {
  const he = lang === 'he';
  const system = he
    ? `אתה יועץ הורי שמתחיל סימולציה. הצג את המצב בטבעיות, שחק את הילד, ובקש מההורה להגיב. 3 משפטים.`
    : 'You are starting a parenting simulation. Present the situation naturally, play the child, and ask the parent to respond. 3 sentences.';

  const fallback = he
    ? `בואו נתרגל. ${scenario.context}\n\nהילד אומר: "${scenario.child}"\n\nמה אתם עונים?`
    : `Let's practice. ${scenario.context}\n\nThe child says: "${scenario.child}"\n\nWhat do you say?`;

  const response = await callAPI(system, [{ role: 'user', content: `${scenario.context}\n"${scenario.child}"` }]);
  if (response) return response;
  return lastApiError ? friendlyApiFallback(lang) : fallback;
}
