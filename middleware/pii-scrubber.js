'use strict';
/**
 * PII Scrubber — Customer Execution Plane
 *
 * Primary defence: runs on every payload BEFORE it crosses the boundary
 * to the DBiz Intelligence API. Employee/customer PII (SSN, bank account,
 * salary, DOB, credentials, etc.) never leaves the OrangeHRM tenant.
 *
 * Source of truth: shared/pii-scrubber.js
 * Keep both files in sync when adding new field patterns.
 */

const SENSITIVE_FIELDS = [
  // PCI / Payment
  'card_number','cardnumber','card_no','cvv','cvc','expiry','expiration',
  'account_number','routing_number','iban','swift_code','bank_account',
  // NPI / Identity
  'ssn','social_security','date_of_birth','dob','drivers_license',
  'passport_number','national_id','tax_id','ein',
  // Compensation / Financial NPI (HR payroll data)
  'annual_income','monthly_income','net_worth',
  'salary','compensation','bonus','pay_grade','hourly_rate','net_salary','gross_salary',
  // Employment / Personnel
  'employee_id','emergency_contact','home_address','personal_email',
  // Auth Secrets — application credentials must never cross the boundary
  'password','passwd','api_key','access_token','refresh_token',
  'session_id','secret','private_key','bearer','authorization',
  'app_username','app_password','test_admin_username','test_admin_password',
  // PHI
  'diagnosis_code','prescription_id','insurance_member_id','npi_number',
  'patient_id','health_plan',
  // OFAC / KYC
  'beneficiary_name','country_of_birth','sanctions_flag','pep_flag',
  'politically_exposed','ofac_status',
];

const MASK = '[REDACTED]';

// ── Value-level patterns ──────────────────────────────────────────────────────
// Key-name matching alone cannot catch PII written inside free-text fields like
// storyTitle / storyDescription. These regexes redact PII by VALUE so it never
// crosses the boundary even when it is embedded in prose.
function luhnValid(num) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = num.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

const VALUE_PATTERNS = [
  { label: 'email',       re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { label: 'ssn',         re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { label: 'iban',        re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  { label: 'phone',       re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  // Credit-card: 13–19 digits (optionally space/dash separated), Luhn-validated to avoid false hits
  { label: 'credit_card', re: /\b(?:\d[ -]?){13,19}\b/g, validate: (m) => luhnValid(m.replace(/[ -]/g, '')) },
];

function scrubString(str, fieldsRedacted = [], path = '') {
  if (typeof str !== 'string' || !str) return str;
  let out = str;
  for (const { label, re, validate } of VALUE_PATTERNS) {
    out = out.replace(re, (m) => {
      if (validate && !validate(m)) return m;
      const tag = `${path}<${label}>`;
      if (!fieldsRedacted.includes(tag)) fieldsRedacted.push(tag);
      return MASK;
    });
  }
  return out;
}

function scrubObj(obj, fieldsRedacted, path = '') {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    const keyLower = k.toLowerCase().replace(/[-\s]/g, '_');
    if (SENSITIVE_FIELDS.some(f => keyLower.includes(f))) {
      out[k] = MASK;
      fieldsRedacted.push(`${path}${k}`);
    } else if (v && typeof v === 'object') {
      out[k] = scrubObj(v, fieldsRedacted, `${path}${k}.`);
    } else if (typeof v === 'string') {
      out[k] = scrubString(v, fieldsRedacted, `${path}${k}`);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function scrub(input) {
  const fieldsRedacted = [];

  if (typeof input === 'string') {
    // 1) field-keyed JSON substrings, then 2) free-text value patterns
    let scrubbed = input;
    for (const field of SENSITIVE_FIELDS) {
      const re = new RegExp(`("${field}"\\s*:\\s*)"[^"]*"`, 'gi');
      if (re.test(scrubbed)) {
        scrubbed = scrubbed.replace(re, `$1"${MASK}"`);
        fieldsRedacted.push(field);
      }
    }
    scrubbed = scrubString(scrubbed, fieldsRedacted);
    return { scrubbed, fieldsRedacted };
  }

  return { scrubbed: scrubObj(input, fieldsRedacted), fieldsRedacted };
}

module.exports = { scrub, scrubString, SENSITIVE_FIELDS, MASK };
