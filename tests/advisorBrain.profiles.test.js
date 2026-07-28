import test from 'node:test';
import assert from 'node:assert/strict';

import { prepareAdvisorTurn } from '../src/advisorBrain.js';

const persona = { name: 'מאיה', nameEn: 'Maya' };
const emptyCase = () => ({ profiles: {}, events: [], insights: [] });

function turn(message, caseData = emptyCase(), conversation = []) {
  return prepareAdvisorTurn({ message, caseData, conversation, lang: 'he', persona });
}

test('keeps the first profile and adds both names from a conflict pair', () => {
  const first = turn('אני רוצה לדבר על איתמר');
  const second = turn('יש מכות בין איתמר ואריאל לפעמים', first.caseData);

  assert.deepEqual(Object.keys(second.caseData.profiles).sort(), ['אריאל', 'איתמר'].sort());
});

test('uses the previous advisor question to understand a one-word name answer', () => {
  const result = turn('אריאל', emptyCase(), [
    { role: 'advisor', text: 'מי בדרך כלל מתחיל את המריבה?' },
  ]);

  assert.equal(result.caseData.profiles['אריאל'].name, 'אריאל');
  assert.equal(result.caseData.profiles['אריאל'].role, 'unknown');
});

test('captures an explicit role correction and age without dropping other profiles', () => {
  const first = turn('יש מכות בין איתמר ואריאל לפעמים');
  const corrected = turn('לא, אריאל הוא הגדול בן 14.5', first.caseData);

  assert.equal(corrected.caseData.profiles['אריאל'].role, 'child');
  assert.equal(corrected.caseData.profiles['אריאל'].age, 14.5);
  assert.equal(corrected.caseData.profiles['איתמר'].name, 'איתמר');
  assert.equal(corrected.caseData.profiles['הגדול'], undefined);
  assert.equal(Object.keys(corrected.caseData.profiles).length, 2);
});

test('does not create a profile from a conjunction before a relationship word', () => {
  const result = turn('אחד מאיתנו, אני או אשתי');

  assert.equal(result.caseData.profiles['או'], undefined);
  assert.equal(Object.keys(result.caseData.profiles).length, 0);
});

test('routes a previous-conversation question through structured memory', () => {
  const rememberedCase = turn('יש מכות בין איתמר ואריאל לפעמים').caseData;
  const recall = turn('את זוכרת את השיחה האחרונה שלנו על איתמר ואריאל?', rememberedCase);

  assert.equal(recall.route, 'memory_recall');
  assert.equal(recall.responseContract.memoryScope, 'full_case');
  assert.match(recall.system, /יש זיכרון מובנה מהתיק/);
  assert.match(recall.system, /איתמר/);
  assert.match(recall.system, /אריאל/);
  assert.match(recall.system, /עיקרי התיק ולא תמליל מלא/);
});

test('does not invent memory when the case is empty', () => {
  const recall = turn('את זוכרת את השיחה האחרונה שלנו?', emptyCase());

  assert.equal(recall.route, 'memory_recall');
  assert.match(recall.system, /אין עדיין זיכרון מובנה מהתיק/);
});
