#!/bin/sh
# ── OrangeHRM Execution Plane — Entrypoint Guard ──────────────────────────────
#
# Enforces the Sovereign Split contract at container boot:
#   ANTHROPIC_API_KEY must NOT be present (AI runs in DBiz tenant only)
#   CLIENT_ID + CLIENT_SECRET must be present (OAuth2 client-credentials from DBiz)
#   JIRA_API_TOKEN must be present (OrangeHRM Jira API token)
#   JIRA_BASE_URL must be present
#   INTELLIGENCE_API_URL must be present

set -e

echo "═══════════════════════════════════════════════════════════════════"
echo "  OrangeHRM Execution Plane — Sovereign Split Contract Check"
echo "═══════════════════════════════════════════════════════════════════"

ERRORS=0

# HARD BAN — any AI provider credential violates the sovereign split model.
# Banning only ANTHROPIC_API_KEY is trivially bypassed via another provider/proxy.
AI_VIOLATION=""
for VAR in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_API_KEY \
           OPENAI_API_KEY OPENAI_API_BASE AZURE_OPENAI_API_KEY AZURE_OPENAI_KEY \
           GOOGLE_API_KEY GEMINI_API_KEY GOOGLE_APPLICATION_CREDENTIALS VERTEX_AI_API_KEY \
           COHERE_API_KEY MISTRAL_API_KEY GROQ_API_KEY TOGETHER_API_KEY \
           HUGGINGFACE_API_KEY HF_TOKEN REPLICATE_API_TOKEN AWS_BEARER_TOKEN_BEDROCK; do
  eval "VAL=\${$VAR}"
  if [ -n "$VAL" ]; then AI_VIOLATION="$AI_VIOLATION $VAR"; fi
done
if [ -n "$AI_VIOLATION" ]; then
  echo "[FAIL] Forbidden AI credential(s) SET:$AI_VIOLATION"
  echo "       This container must NOT have direct AI access — inference runs in the DBiz Intelligence Plane only."
  echo "       Remove the variable(s) above from your environment and restart."
  ERRORS=$((ERRORS + 1))
else
  echo "[ OK ] AI credentials: absent (sovereign boundary enforced)"
fi

# Required credentials — OAuth2 client-credentials (CUSTOMER_JWT is deprecated)
if [ -z "$CLIENT_ID" ] || { [ -z "$CLIENT_SECRET" ] && [ -z "$CLIENT_SECRET_REF" ]; }; then
  echo "[FAIL] CLIENT_ID + CLIENT_SECRET are missing — obtain OAuth2 client credentials from DBiz admin"
  ERRORS=$((ERRORS + 1))
else
  echo "[ OK ] CLIENT_ID/CLIENT_SECRET: present (OAuth2)"
fi

if [ -z "$JIRA_API_TOKEN" ]; then
  echo "[FAIL] JIRA_API_TOKEN is missing — set your OrangeHRM Jira API token"
  ERRORS=$((ERRORS + 1))
else
  echo "[ OK ] JIRA_API_TOKEN: present"
fi

if [ -z "$JIRA_BASE_URL" ]; then
  echo "[FAIL] JIRA_BASE_URL is missing"
  ERRORS=$((ERRORS + 1))
else
  echo "[ OK ] JIRA_BASE_URL: $JIRA_BASE_URL"
fi

if [ -z "$INTELLIGENCE_API_URL" ]; then
  echo "[WARN] INTELLIGENCE_API_URL not set — defaulting to http://localhost:3001"
else
  echo "[ OK ] INTELLIGENCE_API_URL: $INTELLIGENCE_API_URL"
fi

echo "═══════════════════════════════════════════════════════════════════"

if [ "$ERRORS" -gt 0 ]; then
  echo "[ABORT] $ERRORS contract violation(s) found. Container will not start."
  echo "        Fix the issues above and restart."
  exit 1
fi

echo "  All checks passed — starting OrangeHRM Execution Plane"
echo "═══════════════════════════════════════════════════════════════════"

exec "$@"
