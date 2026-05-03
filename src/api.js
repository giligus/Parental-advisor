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

export function buildCleanHistory(msgs) {
  const filtered = (msgs || [])
    .filter(item => item && !item.isErr && !item.isError && !item.isSystem)
    .map(item => ({
      role: item.role === 'user' ? 'user' : 'assistant',
      content: String(item.text || item.content || '').trim(),
    }))
    .filter(item => item.content);

  const merged = [];
  for (const item of filtered) {
    const last = merged[merged.length - 1];
    if (last?.role === item.role) {
      last.content = `${last.content}\n\n${item.content}`;
    } else {
      merged.push({ ...item });
    }
  }

  while (merged.length > 0 && merged[0].role !== 'user') merged.shift();
  return merged.slice(-12);
}

export function buildSystemPrompt(lang, caseData, state, policy, extra = '') {
  const he = lang === 'he';

  const base = he
    ? `את יועצת הורית והתנהגותית מתמשכת בשם מאיה. את מדברת בעברית טבעית, חמה וישירה, כמו יועצת אנושית שמכירה את המשפחה.

כללי סגנון:
- עני ב-2 עד 5 משפטים קצרים וטבעיים. לא יותר.
- בלי כותרות, bullet points, markdown, אחוזים, מספרים או נתונים טכניים.
- אל תחשפי שמות פנימיים כמו State Engine, Analyst Mode, Listener Mode או router.
- אל תמציאי שמות, היסטוריה, קשרים משפחתיים או אירועים שלא נאמרו.
- קודם אנושי, אחר כך מעשי. לא אקדמי ולא רשמי.
- גווני פתיחות. אל תתחילי כל תשובה באותו "אני מבינה" או "זה נשמע קשה".
- אם חסר מידע, שאלי שאלה אחת בלבד.
- אם יש אירוע ברור, התייחסי אליו ישירות ואל תשאלי "מה קרה?" כאילו לא סופר.
- כשאת מציעה ניסוח, תני משפט אחד טבעי בגרשיים.`
    : `You are a continuous behavioral advisor. Speak in natural, calm, warm English, like an advisor who knows the case.

Style rules:
- Human first, practical second.
- Do not expose internal labels like State Engine, Analyst Mode, Listener Mode, or router.
- No headings, bullet points, markdown, percentages, numbers, or technical data.
- Reply in 2 to 5 short natural sentences.
- Do not invent names, history, family relationships, or events.
- Vary your openings.
- If information is missing, ask one short question only.
- If there is a clear event, answer that event directly.
- When giving a script, give one natural sentence in quotes.`;

  const profiles = Object.values(caseData.profiles || {});
  const profileText = profiles.length
    ? `\n\n${he ? 'פרופילים ידועים' : 'Known profiles'}:\n${profiles.map(profile => {
        const age = profile.age ? `, ${he ? 'גיל' : 'age'} ${profile.age}` : '';
        return `${profile.name} (${profile.role || 'other'}${age}): ${profile.notes || (he ? 'אין עדיין מספיק מידע' : 'limited info')}`;
      }).join('\n')}`
    : '';

  const escalations = (caseData.events || []).filter(event => event.outcome === 'escalation').length;
  const improvements = (caseData.events || []).filter(event => event.outcome === 'improvement').length;
  const eventText = (caseData.events || []).length >= 2
    ? `\n\n${he ? 'הקשר פנימי לשיחה, לא להציג כנתונים' : 'Internal conversation context, do not present as data'}:
${he ? 'כיוון כללי' : 'Overall direction'}: ${improvements > escalations ? (he ? 'נראה שיש גם דברים שמתחילים לעבוד' : 'some things are starting to work') : escalations > improvements ? (he ? 'יש כרגע כמה רגעים מאתגרים שחוזרים' : 'there are recurring challenging moments') : (he ? 'עדיין אוספים תמונה' : 'still forming a picture')}
${he ? 'כיוון מומלץ' : 'Recommended direction'}: ${policy?.strat || ''}
${he ? 'כדאי להימנע מ' : 'Worth avoiding'}: ${policy?.avoid || ''}`
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

  return `${base}${responseGuardrails}${profileText}${eventText}${latestEventText}${playbookText}${extra || ''}`;
}

export async function getGreeting(lang) {
  const he = lang === 'he';
  return he
    ? 'שלום, אני כאן איתכם. ספרו לי במה תרצו להתמקד היום, או מה קרה מאז הפעם הקודמת.'
    : "Hi, I'm here with you. Tell me what you'd like to focus on today, or what happened since last time.";
}

export async function getAdvisorResponse(systemPrompt, conversationHistory) {
  const response = await callAPI(systemPrompt, buildCleanHistory(conversationHistory));
  if (response) return response;
  return lastApiError ? friendlyApiFallback(systemPrompt) : 'ספרו לי עוד.';
}

export async function getNaturalRoutedResponse({ lang, route, caseData, conversationHistory, userText }) {
  const he = lang === 'he';
  const profiles = Object.values(caseData?.profiles || {});
  const recentEvents = (caseData?.events || []).slice(-5);
  const routeMode = route?.mode || 'open';
  const missing = route?.context?.missing || null;

  const caseContext = [
    profiles.length
      ? `${he ? 'פרופילים ידועים' : 'Known profiles'}: ${profiles.map(profile => {
          const age = profile.age ? `, ${he ? 'גיל' : 'age'} ${profile.age}` : '';
          return `${profile.name || 'unknown'} (${profile.role || 'other'}${age})`;
        }).join('; ')}`
      : '',
    recentEvents.length
      ? `${he ? 'אירועים אחרונים' : 'Recent events'}: ${recentEvents.map(event => `${event.date}: ${event.type}/${event.outcome} "${event.raw || ''}"`).join(' | ')}`
      : '',
  ].filter(Boolean).join('\n');

  const modeGuideHe = {
    greeting: 'זו ברכה בלבד. עני קצר, חם ומזמין, ושאלי במה נרצה להתמקד היום.',
    continue_last_topic: 'המשתמש מבקש להמשיך מנושא קודם. אם אין מספיק הקשר, בקשי תזכורת קצרה בלי להמציא היסטוריה.',
    correction: 'המשתמש מתקן הנחה שלך. קבלי את התיקון בקצרה, בלי להתגונן, והתחילי נקי.',
    fragment_intake: 'זו הודעה חלקית. אל תנתחי ואל תנחשי. שאלי שאלה אחת קצרה שתעזור להבין על מי או על מה מדובר.',
    clarifying: 'זו פתיחה כללית. עני אנושית ושאלי שאלה אחת שמזמינה לספר מה קורה. אל תנחשי את התוכן.',
    empathic: 'יש מצוקה רגשית. קודם תני תיקוף רגשי, ואז שאלי שאלה אחת עדינה.',
    event_intake: `זה נראה כמו דיווח אירוע חלקי. אל תצרי ניתוח מלא ואל תשלימי פרטים לבד. שאלי שאלה אחת חסרה בהקשר. אם מדובר בהצקות בין אחים, שאלי איך זה נראה בפועל ומה ההורים עושים כשזה מתחיל. הפרט החסר: ${missing || 'הקשר האירוע'}.`,
    action_plan: 'המשתמש מבקש כיוון או תוכנית. אם יש מספיק הקשר, תני צעד אחד-שניים; אם חסר הקשר, שאלי שאלה אחת ממוקדת.',
  };

  const modeGuideEn = {
    greeting: 'This is only a greeting. Reply briefly, warmly, and invite the user to share what they want to focus on.',
    continue_last_topic: 'The user wants to continue a previous topic. If context is missing, ask for a short reminder without inventing history.',
    correction: 'The user is correcting an assumption. Accept it briefly, do not defend yourself, and restart cleanly.',
    fragment_intake: 'This is a partial fragment. Do not analyze. Ask one short question to understand who or what this is about.',
    clarifying: 'This is an open start. Reply humanly and ask one inviting question.',
    empathic: 'The user is emotionally distressed. Validate first, then ask one gentle question.',
    event_intake: `This looks like a partial event report. Do not do a full analysis. Ask one missing contextual question. Missing detail: ${missing || 'event context'}.`,
    action_plan: 'The user asks for direction or a plan. If there is enough context, give one or two steps; if context is missing, ask one focused question.',
  };

  const system = he
    ? `את יועצת התנהגותית וירטואלית מתמשכת בשם מאיה.
דברי בעברית טבעית, חמה, רגועה וישירה, כמו יועצת אנושית שמלווה תיק לאורך זמן.
אל תחשפי שמות פנימיים כמו router, mode, state engine או synthesis.
אל תמציאי פרטים, שמות, היסטוריה או אירועים שלא ניתנו.
עני ב-1 עד 4 משפטים קצרים, ללא markdown וללא כותרות.
אם חסר מידע, שאלי שאלה אחת בלבד.

הנחיית מצב פנימית: ${modeGuideHe[routeMode] || modeGuideHe.clarifying}
${caseContext ? `\nהקשר תיק פנימי, לשימוש עדין בלבד:\n${caseContext}` : ''}`
    : `You are Maya, a continuous virtual behavioral advisor.
Speak in natural, warm, calm, direct English, like a human advisor following a case over time.
Do not reveal internal labels like router, mode, state engine, or synthesis.
Do not invent details, names, history, or events not provided.
Reply in 1 to 4 short sentences, no markdown and no headings.
If information is missing, ask exactly one question.

Internal response guide: ${modeGuideEn[routeMode] || modeGuideEn.clarifying}
${caseContext ? `\nInternal case context, use gently:\n${caseContext}` : ''}`;

  const history = conversationHistory?.length
    ? conversationHistory
    : [{ role: 'user', content: userText || (he ? 'שלום' : 'Hello') }];

  return callAPI(system, history);
}

export async function extractProfiles(recentMessages) {
  const system = `Extract person profiles from this parenting/advisory conversation.
Return ONLY valid JSON, no markdown.

Format:
{"profiles":[{"name":"string","role":"child|parent|partner|sibling|student|other","age":null,"challenges":[],"strengths":[],"triggers":[],"whatWorks":[],"notes":""}]}

Rules:
- Create a profile for every named person being discussed, not only the speaker.
- Infer role from context: "my son", "הבן שלי", "ילד", "בת 7" => child; "אחותו"/"brother" can be sibling/child.
- Extract age when stated.
- Extract challenges/triggers from behavior mentions such as screens, siblings, screaming, homework, transitions.
- Do not invent names. If no named person appears, return {"profiles":[]}.
- If a person is named but details are missing, still include them with role "other" and a short note.`;

  const content = (recentMessages || [])
    .filter(item => item && !item.isErr && !item.isError && !item.isSystem)
    .map(item => `${item.role}: ${item.text || item.content || ''}`)
    .join('\n');
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
