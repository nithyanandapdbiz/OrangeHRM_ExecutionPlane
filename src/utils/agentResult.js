'use strict';

class AgentResultError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'AgentResultError';
    this.code = code;
    this.details = details;
  }
}

function ok(data, metadata = {}) {
  return { ok: true, data, metadata: { ...metadata } };
}

function fail(code, message, details = {}, canRetry = false) {
  return { ok: false, error: { code, message, details }, canRetry };
}

async function fromAsync(fn, { code = 'AGENT_ERROR', canRetry = false } = {}) {
  try {
    const data = await fn();
    return ok(data);
  } catch (err) {
    return fail(code, err.message, { originalError: err.message }, canRetry);
  }
}

function unwrap(result) {
  if (!result || typeof result.ok !== 'boolean') {
    throw new AgentResultError('Value is not an AgentResult', 'NOT_AGENT_RESULT', {});
  }
  if (!result.ok) {
    throw new AgentResultError(result.error.message, result.error.code, result.error.details);
  }
  return result.data;
}

function unwrapOrFallback(result, fallback) {
  if (!result || !result.ok) return fallback;
  return result.data;
}

function isAgentResult(value) {
  return value !== null && typeof value === 'object' && typeof value.ok === 'boolean';
}

function isOk(result) {
  return isAgentResult(result) && result.ok === true;
}

function isFail(result) {
  return isAgentResult(result) && result.ok === false;
}

function isDegraded(result) {
  return isAgentResult(result) && result.ok === true && !!(result.metadata && result.metadata.degraded);
}

module.exports = {
  ok,
  fail,
  fromAsync,
  unwrap,
  unwrapOrFallback,
  isAgentResult,
  isOk,
  isFail,
  isDegraded,
  AgentResultError
};
