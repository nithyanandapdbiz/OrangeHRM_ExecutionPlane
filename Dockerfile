# ── OrangeHRM Execution Plane — Dockerfile ────────────────────────────────────
#
# Sovereign Split Architecture — Customer (OrangeHRM) Tenant
#
# SECURITY CONTRACT:
#   - ANTHROPIC_API_KEY must NOT be set — entrypoint guard will exit(1) if found
#   - AI inference happens exclusively on the DBiz Intelligence Plane (other tenant)
#   - App credentials (APP_USERNAME, APP_PASSWORD) stay in Customer storage only
#   - JIRA_API_TOKEN / ZEPHYR_API_TOKEN stay in Customer storage only — DBiz never sees them
#   - Only scrubbed story metadata crosses the DBiz boundary (JWT-authenticated HTTPS)
#
# Required at runtime:
#   CUSTOMER_JWT          — JWT issued by DBiz admin/provision-tenant
#   JIRA_API_TOKEN        — OrangeHRM Jira API token (paired with JIRA_EMAIL)
#   JIRA_BASE_URL         — https://<org>.atlassian.net
#   JIRA_PROJECT_KEY      — OHRM
#   ZEPHYR_API_TOKEN      — Zephyr Essential bearer token
#   APP_BASE_URL          — https://opensource-demo.orangehrmlive.com
#   INTELLIGENCE_API_URL  — https://intelligence.dbiz.io  (or internal cluster endpoint)
#
# FORBIDDEN at runtime:
#   ANTHROPIC_API_KEY     — hard ban (entrypoint exits on detection)
# ──────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Execution Plane dependencies ─────────────────────────────────────
FROM node:20-slim AS exec-deps
WORKDIR /build/exec
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Stage 2: Platform dependencies (Playwright + agents) ──────────────────────
FROM node:20-slim AS platform-deps
WORKDIR /build/platform

# PLATFORM_DIR is the path to OrangeHRM_AgenticQAPlatform — mounted or copied at build time
# Copy only package.json files for dependency install; tests/agents are volume-mounted at runtime
ARG PLATFORM_PACKAGE_DIR=../OrangeHRM_AgenticQAPlatform
COPY ${PLATFORM_PACKAGE_DIR}/package.json ${PLATFORM_PACKAGE_DIR}/package-lock.json* ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium

# ── Stage 3: Final runtime image ──────────────────────────────────────────────
FROM node:20-slim AS final
WORKDIR /app

# Execution Plane application code
COPY --from=exec-deps /build/exec/node_modules ./node_modules
COPY . .

# Platform node_modules (for Playwright) — separate path so they don't clash
COPY --from=platform-deps /build/platform/node_modules /platform/node_modules
COPY --from=platform-deps /root/.cache /root/.cache

# Platform agent source is VOLUME-MOUNTED at runtime — not baked into the image
# This ensures OrangeHRM can update their test suite without rebuilding the container
VOLUME ["/platform/src"]

ENV NODE_ENV=production
ENV PORT=3000
ENV PLATFORM_DIR=/platform

# Startup entrypoint guard — enforces sovereign split contract before launching server
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000

# Liveness probe for orchestrators that honour image HEALTHCHECK (Compose, Swarm,
# Nomad). Kubernetes ignores this and uses the chart's httpGet probe instead.
# Uses Node's built-in http client — no curl/wget dependency in the slim image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
