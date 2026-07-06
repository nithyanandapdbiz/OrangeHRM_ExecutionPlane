'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Reference-template hygiene: framework code must contain NO hardcoded tenant
// VALUES. Tenant identity (id/domain/name) lives only in config/customer.json;
// AI selection lives only in config/ai-profile.json. A new tenant onboards by
// editing config, never framework code (docs/ONBOARDING.md).

const ROOT = path.resolve(__dirname, '..');
const FRAMEWORK = ['server.js', 'routes', 'clients', 'runners', 'lib', 'middleware'];

// Quoted literals (code values) of THIS tenant's identity — must not appear in code.
const FORBIDDEN_LITERALS = [/'orangehrm'/i, /"orangehrm"/i, /'human-resources'/i, /"human-resources"/i];

function walk(target, out) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) return out;
  const st = fs.statSync(full);
  if (st.isFile()) { if (full.endsWith('.js')) out.push(full); return out; }
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(target, e.name), out);
    else if (e.name.endsWith('.js')) out.push(path.join(full, e.name));
  }
  return out;
}

test('FF: no hardcoded tenant identity value in framework code', () => {
  const offenders = [];
  for (const f of FRAMEWORK.flatMap((t) => walk(t, []))) {
    const src = fs.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (FORBIDDEN_LITERALS.some((rx) => rx.test(line))) {
        offenders.push(`${path.relative(ROOT, f)}:${i + 1}  ${line.trim().slice(0, 80)}`);
      }
    });
  }
  assert.deepStrictEqual(offenders, [], `Tenant values must come from config/customer.json, not code:\n${offenders.join('\n')}`);
});

test('FF: tenant templates and onboarding runbook exist', () => {
  for (const f of ['config/customer.template.json', 'config/ai-profile.template.json', 'docs/ONBOARDING.md']) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} must exist (reference template)`);
  }
});

test('FF: templates contain placeholders, not this tenant’s real values', () => {
  const t = fs.readFileSync(path.join(ROOT, 'config/customer.template.json'), 'utf8');
  assert.ok(!/orangehrm|human-resources/i.test(t), 'customer.template.json must not contain real tenant values');
  assert.match(t, /<your-tenant-id>/, 'template must use placeholders');
});
