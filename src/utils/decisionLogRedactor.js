'use strict';

/**
 * decisionLogRedactor — field-path and PII-pattern redaction for decision log entries.
 *
 * Controlled entirely via env vars (read at call time):
 *   DECISION_LOG_REDACT_FIELDS   — comma-separated dot-paths to redact
 *                                  e.g. "metadata.input.email,metadata.output.ssn"
 *   DECISION_LOG_REDACT_PATTERNS — comma-separated PII pattern names
 *                                  Supported: email, phone, employee-id, national-id
 *
 * Both mechanisms replace matched values with "[REDACTED]" and set `redacted: true`
 * on the affected entry. Pattern redaction is applied only to the `metadata`
 * sub-object to avoid corrupting schema fields (agent, pipeline, stage, etc.).
 *
 * Returns a deep-cloned, never-mutated copy when redaction is active.
 */

// ── PII pattern registry ──────────────────────────────────────────────────────

const PATTERNS = {
  email: {
    source: '[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}',
    flags:  'g'
  },
  phone: {
    // Matches US/intl phone numbers: (555) 123-4567, +1-555-123-4567, 5551234567
    source: '\\b(\\+?1[\\s\\-.]?)?\\(?\\d{3}\\)?[\\s\\-.]?\\d{3}[\\s\\-.]?\\d{4}\\b',
    flags:  'g'
  },
  'employee-id': {
    // Matches EMP-12345, EMP12345 (case-insensitive)
    source: '\\b(?:EMP)[-]?\\d{4,8}\\b',
    flags:  'gi'
  },
  'national-id': {
    // Matches SSN-format: 123-45-6789
    source: '\\b\\d{3}[-]\\d{2}[-]\\d{4}\\b',
    flags:  'g'
  }
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Traverse dot-path in obj and replace the leaf with '[REDACTED]'.
 * Returns true if the path existed and was redacted.
 */
function _setAtPath(obj, dotPath) {
  if (!obj || typeof obj !== 'object') return false;
  const parts = dotPath.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (node[p] === null || node[p] === undefined || typeof node[p] !== 'object') {
      return false;
    }
    node = node[p];
  }
  const leaf = parts[parts.length - 1];
  if (!Object.prototype.hasOwnProperty.call(node, leaf)) return false;
  node[leaf] = '[REDACTED]';
  return true;
}

/**
 * Recursively walk val (string | array | plain object | primitive) and
 * replace PII pattern matches with '[REDACTED]'.
 *
 * @param {*}      val            Value to walk
 * @param {Array}  regexEntries   [[name, {source, flags}], ...]
 * @param {Set}    matchedNames   Accumulates which pattern names fired
 * @param {{count: number}} countRef  Mutable counter for total matches
 * @returns {*} Potentially modified value (strings and containers are new objects)
 */
function _applyPatternsToValue(val, regexEntries, matchedNames, countRef) {
  if (typeof val === 'string') {
    let result = val;
    for (const [name, { source, flags }] of regexEntries) {
      const rx = new RegExp(source, flags);
      result = result.replace(rx, () => {
        countRef.count++;
        matchedNames.add(name);
        return '[REDACTED]';
      });
    }
    return result;
  }
  if (Array.isArray(val)) {
    return val.map(item => _applyPatternsToValue(item, regexEntries, matchedNames, countRef));
  }
  if (val !== null && typeof val === 'object') {
    const out = {};
    for (const key of Object.keys(val)) {
      out[key] = _applyPatternsToValue(val[key], regexEntries, matchedNames, countRef);
    }
    return out;
  }
  return val; // number, boolean, null, undefined
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply field-path and PII-pattern redaction to a decision log entry.
 *
 * Fast path (no-op) when neither DECISION_LOG_REDACT_FIELDS nor
 * DECISION_LOG_REDACT_PATTERNS is set — returns the original entry reference
 * without cloning.
 *
 * @param {object} entry - Fully built JSONL entry (never mutated)
 * @returns {{
 *   entry:    object,
 *   redacted: boolean,
 *   report:   { count: number, fields: string[], patterns: string[] }
 * }}
 */
function redactEntry(entry) {
  const fieldsEnv   = (process.env.DECISION_LOG_REDACT_FIELDS   || '').trim();
  const patternsEnv = (process.env.DECISION_LOG_REDACT_PATTERNS || '').trim();

  // Fast path — nothing to do
  if (!fieldsEnv && !patternsEnv) {
    return { entry, redacted: false, report: { count: 0, fields: [], patterns: [] } };
  }

  const cloned = JSON.parse(JSON.stringify(entry));
  const redactedFields = [];
  const matchedPatterns = new Set();
  const countRef = { count: 0 };

  // 1. Field-path redaction (any dot-path in the entry)
  if (fieldsEnv) {
    for (const dotPath of fieldsEnv.split(',').map(p => p.trim()).filter(Boolean)) {
      if (_setAtPath(cloned, dotPath)) {
        redactedFields.push(dotPath);
        countRef.count++;
      }
    }
  }

  // 2. Pattern redaction — applied to metadata only (user-controlled content)
  if (patternsEnv && cloned.metadata) {
    const regexEntries = patternsEnv
      .split(',')
      .map(p => p.trim())
      .filter(p => PATTERNS[p])
      .map(p => [p, PATTERNS[p]]);

    if (regexEntries.length > 0) {
      cloned.metadata = _applyPatternsToValue(cloned.metadata, regexEntries, matchedPatterns, countRef);
    }
  }

  const didRedact = redactedFields.length > 0 || matchedPatterns.size > 0;
  if (didRedact) {
    cloned.redacted = true;
  }

  return {
    entry:    cloned,
    redacted: didRedact,
    report: {
      count:    countRef.count,
      fields:   redactedFields,
      patterns: [...matchedPatterns]
    }
  };
}

/** Names of all built-in PII pattern types. */
const KNOWN_PATTERN_NAMES = Object.keys(PATTERNS);

module.exports = { redactEntry, KNOWN_PATTERN_NAMES };
