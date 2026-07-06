'use strict';
/**
 * issueKeyResolver — canonical work-item key parsing for the AgenticQA platform.
 *
 * All consumers MUST use resolveIssueKey() instead of inline key parsing.
 * This prevents split('-')[1] bugs and ensures both key formats work everywhere.
 *
 * Supported formats (Jira alphanumeric keys — the full key is ALWAYS preserved):
 *   Numeric only    "3276"           → { raw: "3276",         id: 3276,  key: "3276"         }
 *   Prefix-Number   "OHRM-1"         → { raw: "OHRM-1",       id: 1,     key: "OHRM-1"       }
 *   Prefix-Number   "AI-12345"       → { raw: "AI-12345",     id: 12345, key: "AI-12345"     }
 *   Multi-part pfx  "MY-PROJECT-99"  → { raw: "MY-PROJECT-99",id: 99,    key: "MY-PROJECT-99"}
 *
 * IMPORTANT: `key` retains the full alphanumeric Jira key (e.g. OHRM-1). Only the
 * numeric `id` convenience field extracts the trailing digits; Jira REST calls
 * MUST use `key`, never `id`, so the alphanumeric project prefix is never stripped.
 *
 * Resolution priority for CLI-driven scripts:
 *   1. CLI positional argument (first non-flag argv)
 *   2. ISSUE_KEY environment variable
 *   3. Validation failure (clear error message)
 */

/**
 * Parse a raw work-item key string into its canonical components.
 *
 * Uses lastIndexOf('-') for prefix extraction so multi-hyphen prefixes
 * such as "MY-PROJECT-5" resolve correctly (id = 5, not NaN). The alphanumeric
 * `key` is preserved verbatim.
 *
 * @param {string|number} raw - Key from CLI arg, ISSUE_KEY env var, or Jira payload
 * @returns {{ raw: string, id: number, key: string }}
 * @throws {Error} when the value is empty or does not match a supported format
 */
function resolveIssueKey(raw) {
  const str = String(raw ?? '').trim();

  if (!str) {
    throw new Error(
      'ISSUE_KEY is required but was not provided.\n' +
      'Set it in .env (e.g. ISSUE_KEY=OHRM-1) ' +
      'or pass it as a positional CLI argument.'
    );
  }

  // Numeric-only — e.g. "3276"
  if (/^\d+$/.test(str)) {
    return { raw: str, id: parseInt(str, 10), key: str };
  }

  // Prefix-Number — e.g. "OHRM-1", "AI-1", "MY-PROJECT-123"
  // Prefix must start with a letter; number is the segment after the last dash.
  // The full alphanumeric key is preserved as `key` — never rebuilt from `id`.
  if (/^[A-Za-z][A-Za-z0-9_ -]*-\d+$/.test(str)) {
    const lastDash = str.lastIndexOf('-');
    const id = parseInt(str.substring(lastDash + 1), 10);
    return { raw: str, id, key: str };
  }

  throw new Error(
    `Invalid ISSUE_KEY format: "${str}".\n` +
    'Expected a numeric work-item ID (e.g. 3276) ' +
    'or a Jira PREFIX-NUMBER key (e.g. OHRM-1, AI-12345).'
  );
}

/**
 * Extract the numeric ID from a Jira key in either supported format.
 * Convenience wrapper around resolveIssueKey — equivalent to resolveIssueKey(raw).id.
 *
 * @param {string|number} raw
 * @returns {number}
 * @throws {Error} when the key is missing or invalid
 */
function extractId(raw) {
  return resolveIssueKey(raw).id;
}

module.exports = { resolveIssueKey, extractId };
