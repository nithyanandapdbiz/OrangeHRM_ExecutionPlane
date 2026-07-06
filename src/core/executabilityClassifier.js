'use strict';
/**
 * executabilityClassifier.js — classify a test step by the automation layer it
 * targets, so the feature writer can annotate non-UI steps and tag scenarios.
 *
 *   UI       — browser-automatable via Playwright (default for web-app steps)
 *   API      — verified through an HTTP/REST call, not the browser
 *   DATABASE — verified by querying a data store directly
 *   MANUAL   — requires human judgement; cannot be automated
 *
 * classifyStep(text) → { type, confidence, signals }
 */

const STEP_TYPES = {
  UI:       'UI',
  API:      'API',
  DATABASE: 'DATABASE',
  MANUAL:   'MANUAL',
};

const SIGNALS = [
  { type: STEP_TYPES.API,      re: /\b(api|endpoint|rest|http request|status code|response body|payload|graphql|webhook)\b/i },
  { type: STEP_TYPES.DATABASE, re: /\b(database|db\b|sql|query the|table|record in the (db|database)|persisted|stored procedure|row count)\b/i },
  { type: STEP_TYPES.MANUAL,   re: /\b(manually|by hand|visually inspect|human review|physically|out of band|email is received|sms)\b/i },
  { type: STEP_TYPES.UI,       re: /\b(click|type|fill|enter|navigate|button|page|form|field|dropdown|modal|dialog|menu|tab|toast|table row|is displayed|is visible|login|log in|select)\b/i },
];

/**
 * @param {string} text - the raw step text
 * @returns {{ type: string, confidence: number, signals: string[] }}
 */
function classifyStep(text) {
  const s = String(text || '');
  const matched = [];
  for (const sig of SIGNALS) {
    if (sig.re.test(s)) matched.push(sig.type);
  }
  // Priority: an explicit API/DATABASE/MANUAL signal wins over UI; default UI.
  const type =
    matched.find(t => t === STEP_TYPES.API) ||
    matched.find(t => t === STEP_TYPES.DATABASE) ||
    matched.find(t => t === STEP_TYPES.MANUAL) ||
    STEP_TYPES.UI;
  const confidence = matched.length ? Math.min(1, 0.5 + matched.length * 0.2) : 0.5;
  return { type, confidence, signals: matched };
}

module.exports = { classifyStep, STEP_TYPES };
