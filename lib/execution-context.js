'use strict';
/**
 * ExecutionContext V1 (Model B — tenant-owned AI).
 *
 * The Execution Plane is the AUTHORITATIVE owner of all tenant-specific concerns:
 * business config, AI selection (provider/model/prompt/knowledge/credential
 * REFERENCES), connector references, and routing/guardrail preferences. On every
 * call it assembles this immutable, versioned context and ships it to the shared,
 * provider-agnostic DBiz Intelligence Plane, which executes SOLELY from it.
 *
 * Invariants:
 *   • NO raw secrets — only references (`kv://…`). Credentials resolve in the IP.
 *   • NO inference here — the EP selects; the IP runs (see test/ai-boundary FF-01).
 *   • Immutable — the returned object is deep-frozen.
 *
 * Field classification (per property): see FIELD_CLASSIFICATION below —
 *   mandatory | optional | computed | sensitive-ref | immutable | versioned.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const customer = require('../config/customer.json');

const CONTEXT_VERSION = 'v1';

// Only these credential/knowledge reference schemes may cross the boundary.
const ALLOWED_REF_SCHEMES = ['kv://', 'vault://', 'akv://', 'asm://', 'sm://'];
const ALLOWED_TOP_KEYS = ['version', 'metadata', 'tenant', 'identity', 'security', 'ai', 'business', 'connectors', 'telemetry'];

// Deterministic, canonical JSON (sorted keys) so integrity/signature are stable
// across serialisations on both planes.
function canonical(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o === undefined ? null : o);
  if (Array.isArray(o)) return '[' + o.map(canonical).join(',') + ']';
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}

// The EP's request-signing key (its OWN secret — not an AI provider credential).
function signingKey() { return process.env.CONTEXT_SIGNING_KEY || process.env.API_SECRET || null; }

// A reference must use an approved scheme (prevents SSRF / arbitrary URIs).
function assertRefScheme(name, value) {
  if (!value) return;
  if (!ALLOWED_REF_SCHEMES.some((s) => String(value).startsWith(s))) {
    throw new Error(`${name} must use an approved reference scheme (${ALLOWED_REF_SCHEMES.join(', ')})`);
  }
}

function loadAiProfile() {
  // Tenant owns AI config. File is the source of truth; env may override scalars
  // (still references/selection only — never raw keys, enforced by the allowlist).
  const file = process.env.AI_PROFILE_PATH || path.join(__dirname, '..', 'config', 'ai-profile.json');
  let profile = {};
  try { profile = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* fall back to env */ }
  return {
    provider:      process.env.AI_PROVIDER        || profile.provider      || null,
    model:         process.env.AI_MODEL           || profile.model         || null,
    fallbackModel: process.env.AI_FALLBACK_MODEL  || profile.fallbackModel || null,
    parameters: {
      maxTokens:   intOr(process.env.AI_MAX_TOKENS,  profile.parameters?.maxTokens),
      temperature: numOr(process.env.AI_TEMPERATURE, profile.parameters?.temperature),
      topP:        numOr(process.env.AI_TOP_P,       profile.parameters?.topP),
    },
    credentialRef: process.env.AI_CREDENTIAL_REF  || profile.credentialRef || null,
    promptPack:    profile.promptPack || (process.env.PROMPT_PACK ? { ref: process.env.PROMPT_PACK, version: process.env.PROMPT_VERSION || null } : null),
    knowledgeRefs: profile.knowledgeRefs || (process.env.KNOWLEDGE_REF ? [process.env.KNOWLEDGE_REF] : []),
    routing:       profile.routing || (process.env.AI_ROUTING_STRATEGY ? { strategy: process.env.AI_ROUTING_STRATEGY } : null),
    guardrails:    profile.guardrails || null,
  };
}

const intOr = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));
const numOr = (v, d) => (v === undefined || v === '' ? d : Number.parseFloat(v));

// A credential reference must be a REFERENCE, not a raw key. Reject obvious keys.
function assertReference(name, value) {
  if (!value) return;
  if (/^sk-|^sk-ant-|^[A-Za-z0-9_-]{40,}$/.test(value) && !/:\/\//.test(value)) {
    throw new Error(`${name} must be a reference (e.g. kv://…), not a raw secret — raw AI credentials never enter the Execution Plane`);
  }
}

/**
 * Build the immutable, versioned ExecutionContext.
 * @param {object} opts
 * @param {string} opts.executionId   computed per run (mandatory)
 * @param {string} opts.correlationId propagated for tracing (mandatory)
 * @param {string} opts.timestamp     ISO-8601 (mandatory, caller-supplied — no Date.now here)
 * @param {object} [opts.business]    per-call business inputs (storyId, storyTitle, …)
 * @param {object} [opts.user]        acting user { id, roles } (optional)
 * @param {string} [opts.classification] data classification (default 'confidential')
 */
function build(opts = {}) {
  const ai = loadAiProfile();
  // Reference hygiene: no raw secret + only approved schemes (SSRF/leak defence).
  assertReference('credentialRef', ai.credentialRef);
  assertRefScheme('credentialRef', ai.credentialRef);
  (ai.knowledgeRefs || []).forEach((r, i) => assertRefScheme(`knowledgeRefs[${i}]`, r));
  if (ai.promptPack?.ref && /:\/\//.test(ai.promptPack.ref)) assertRefScheme('promptPack.ref', ai.promptPack.ref);

  const nonce = opts.nonce || crypto.randomBytes(16).toString('hex'); // replay defence

  const ctx = {
    version: CONTEXT_VERSION,
    metadata: {
      executionId:   opts.executionId || null,
      correlationId: opts.correlationId || null,
      timestamp:     opts.timestamp || null,
      source:        'orangehrm-execution-plane',
    },
    tenant: {
      id:     customer.customerId,
      name:   customer.customerName,
      domain: customer.domain,
    },
    identity: {
      userId: opts.user?.id || null,
      roles:  opts.user?.roles || [],
      // The tenant JWT travels in the Authorization header, not the body.
    },
    security: {
      classification: opts.classification || 'confidential',
      credentialRefs: { ai: ai.credentialRef },   // reference only
      nonce,                                       // replay defence (IP tracks seen nonces)
    },
    ai: {
      provider:      ai.provider,
      model:         ai.model,
      fallbackModel: ai.fallbackModel,
      parameters:    ai.parameters,
      promptPack:    ai.promptPack,
      knowledgeRefs: ai.knowledgeRefs,
      routing:       ai.routing,
      guardrails:    ai.guardrails,
    },
    business: opts.business || {},
    connectors: {
      jira:   { baseUrl: process.env.JIRA_BASE_URL || null, projectKey: process.env.JIRA_PROJECT_KEY || null }, // refs, not creds
      zephyr: { apiUrl: process.env.ZEPHYR_API_URL || null },
      app:    { baseUrl: process.env.APP_BASE_URL || process.env.TEST_BASE_URL || null },
    },
    telemetry: {
      correlationId: opts.correlationId || null,
    },
  };

  // Integrity + optional signature over the canonical form (excluding these fields).
  const canon = canonical(ctx);
  ctx.security.integrity = 'sha256:' + crypto.createHash('sha256').update(canon).digest('hex');
  const key = signingKey();
  ctx.security.signature = key
    ? 'hmac-sha256:' + crypto.createHmac('sha256', key).update(canon).digest('hex')
    : null;

  return deepFreeze(ctx);
}

/**
 * Verify a context's integrity checksum and (if present) HMAC signature.
 * Returns { ok, integrityValid, signatureValid }. Detects tampering + forgery.
 */
function verifyIntegrity(ctx, key = signingKey()) {
  if (!ctx || !ctx.security) return { ok: false, integrityValid: false, signatureValid: false };
  const { integrity, signature, ...restSecurity } = ctx.security;
  const canon = canonical({ ...ctx, security: restSecurity });
  const expectedHash = 'sha256:' + crypto.createHash('sha256').update(canon).digest('hex');
  const integrityValid = integrity === expectedHash;
  let signatureValid = true;
  if (signature) {
    if (!key) return { ok: false, integrityValid, signatureValid: false, reason: 'signing key required' };
    const expected = 'hmac-sha256:' + crypto.createHmac('sha256', key).update(canon).digest('hex');
    signatureValid = signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
  return { ok: integrityValid && signatureValid, integrityValid, signatureValid };
}

/** Strict validation: mandatory fields, reference-only + approved-scheme credential,
 *  and REJECTION of any unknown top-level property (schema hardening). */
function validate(ctx) {
  const errors = [];
  if (ctx?.version !== CONTEXT_VERSION) errors.push(`version must be ${CONTEXT_VERSION}`);
  for (const f of ['executionId', 'correlationId', 'timestamp']) {
    if (!ctx?.metadata?.[f]) errors.push(`metadata.${f} is mandatory`);
  }
  if (!ctx?.tenant?.id) errors.push('tenant.id is mandatory');
  if (!ctx?.ai?.provider || !ctx?.ai?.model) errors.push('ai.provider and ai.model are mandatory (Model B)');
  const ref = ctx?.security?.credentialRefs?.ai;
  if (ref && !ALLOWED_REF_SCHEMES.some((s) => ref.startsWith(s))) {
    errors.push(`security.credentialRefs.ai must use an approved reference scheme (${ALLOWED_REF_SCHEMES.join(', ')})`);
  }
  // Strict schema — reject unknown top-level properties (tamper/injection defence).
  for (const k of Object.keys(ctx || {})) {
    if (!ALLOWED_TOP_KEYS.includes(k)) errors.push(`unknown top-level property rejected: ${k}`);
  }
  return { ok: errors.length === 0, errors };
}

function deepFreeze(o) {
  Object.keys(o).forEach((k) => { if (o[k] && typeof o[k] === 'object') deepFreeze(o[k]); });
  return Object.freeze(o);
}

// Property classification (documentation + governance).
const FIELD_CLASSIFICATION = {
  'metadata.executionId': 'computed|mandatory|immutable',
  'metadata.correlationId': 'computed|mandatory',
  'metadata.timestamp': 'computed|mandatory',
  'tenant.id': 'mandatory|immutable',
  'ai.provider': 'mandatory|versioned',
  'ai.model': 'mandatory|versioned',
  'ai.fallbackModel': 'optional',
  'security.credentialRefs.ai': 'mandatory|sensitive-ref',
  'ai.promptPack': 'optional|versioned',
  'ai.knowledgeRefs': 'optional',
  'business': 'mandatory',
  'connectors': 'optional',
};

module.exports = {
  CONTEXT_VERSION, ALLOWED_REF_SCHEMES,
  build, validate, verifyIntegrity, canonical,
  loadAiProfile, assertReference, assertRefScheme, FIELD_CLASSIFICATION,
};
