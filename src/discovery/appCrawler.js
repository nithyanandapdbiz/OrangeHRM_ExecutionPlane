'use strict';
/**
 * appCrawler.js — Execution-Plane deterministic application crawler (enterprise).
 *
 * The Execution half of the Sovereign-Split Discovery flow. Drives a real browser
 * (Playwright/chromium) against the customer application and captures a structural
 * "application surface" — routes, forms, rich UI components, a navigation graph,
 * and observed API traffic.
 *
 * Performs ZERO AI reasoning. It never builds prompts, App Models, POMs or
 * contracts (Intelligence-Plane responsibilities). It only does browser
 * automation, DOM/network capture, form + component extraction, and PII removal.
 *
 * Enterprise capabilities:
 *   • robust authenticated login (waits for the form + verifies the post-login route)
 *   • SPA-aware discovery — harvests in-app menu/router links, not just <a href> on
 *     the landing page; bounded multi-level traversal
 *   • BFS or DFS traversal, cycle + duplicate detection, URL normalisation
 *   • advanced component classification (buttons, tables, tabs, dialogs, selects,
 *     file-uploads, …) with ARIA/label/enabled metadata + selector hints
 *   • navigation graph (edges between routes)
 *
 * Safety: single context, read-only (never clicks destructive controls), host
 * allow-list, bounded by maxDepth/maxPages/timeout. Authorization/Cookie headers
 * are stripped at source (the controller runs the full PII scrubber before egress).
 */

const { chromium } = require('@playwright/test');
const logger = require('../../lib/logger');

const DEFAULTS = {
  maxDepth: 3,
  maxPages: 60,
  requestTimeoutMs: 20000,
  navSettleMs: 900,
  headless: true,
  captureBodyMaxBytes: 8192,
  strategy: 'bfs',            // 'bfs' (breadth-first) | 'dfs' (depth-first)
  ignoreQuery: true,          // dedupe ?a=1 variants of the same path
  maxComponentsPerPage: 400,
  verifyAuth: true,
  // Phase-2 coverage knobs (all additive; safe defaults)
  dynamicContent: true,       // scroll to trigger lazy/infinite/virtualised loading
  scrollSteps: 6,
  scrollDelayMs: 300,
  maxScrollPx: 24000,
  discoverIframes: true,      // evaluate same-origin iframes and merge
  pierceShadowDom: true,      // (informational — extractor always pierces open roots)
  // OrangeHRM defaults; overridable for other apps.
  loginPath: '/web/index.php/auth/login',
  authenticatedUrlPattern: '/dashboard',
  menuSelectors: ['.oxd-main-menu a[href]', 'nav a[href]', 'aside a[href]', '[role="navigation"] a[href]'],
};

const TRACKING_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', '_ga']);

// ── Pure URL helpers (exported for unit testing) ─────────────────────────────
function hostOf(u) { try { return new URL(u).host; } catch { return ''; } }
function pathOf(u) { try { return new URL(u).pathname; } catch { return u; } }

function normaliseUrl(rawUrl, { ignoreQuery = true } = {}) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    if (ignoreQuery) {
      u.search = '';
    } else {
      // drop tracking params + sort the rest for stable dedupe keys
      const kept = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()));
      kept.sort(([a], [b]) => a.localeCompare(b));
      u.search = new URLSearchParams(kept).toString();
    }
    // normalise trailing slash (keep root "/")
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch { return rawUrl; }
}

function isInScope(url, allowedHosts) { return allowedHosts.has(hostOf(url)); }

// FNV-1a 32-bit — stable, dependency-free content fingerprint for incremental discovery.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ── In-browser surface extraction (forms + components + links + a11y) ────────
// Pierces open Shadow DOM (nested) so Web-Component apps are discovered too.
/* istanbul ignore next — executes in the page context */
function extractSurfaceInBrowser(maxComponents) {
  let shadowRoots = 0;
  // Shadow-piercing querySelectorAll: walks the light DOM and recurses into every
  // open shadowRoot it encounters (handles nested Web Components).
  const deepAll = (selector, root = document) => {
    const out = [];
    const walk = (node) => {
      try { out.push(...node.querySelectorAll(selector)); } catch { /* invalid sel in root */ }
      const hosts = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (const el of hosts) {
        if (el.shadowRoot) { shadowRoots++; walk(el.shadowRoot); }
      }
    };
    walk(root);
    return out;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const hintsFor = (el) => {
    const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 6);
    return {
      testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || null,
      id: el.id || null,
      name: el.getAttribute('name') || null,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || null,
      classes: cls,
      ariaName: el.getAttribute('aria-label') || el.getAttribute('placeholder') || null,
      role: el.getAttribute('role') || null,
      text: (el.textContent || '').trim().slice(0, 40) || null,
    };
  };
  const stability = (h) => (h.testId ? 'high' : (h.id || h.name) ? 'medium' : (h.ariaName || h.role) ? 'low' : 'weak');

  // Forms
  const forms = [];
  for (const form of Array.from(deepAll('form'))) {
    const fields = [];
    for (const el of Array.from(deepAll('input, select, textarea', form))) {
      const type = (el.getAttribute('type') || el.tagName.toLowerCase());
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
      const hints = hintsFor(el);
      fields.push({
        name: el.getAttribute('name') || el.id || '',
        type,
        required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
        maxLength: el.maxLength && el.maxLength > 0 ? el.maxLength : null,
        minLength: el.minLength && el.minLength > 0 ? el.minLength : null,
        pattern: el.getAttribute('pattern') || null,
        selectorHints: hints,
        stability: stability(hints),
      });
    }
    const submitEl = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
    forms.push({
      name: form.getAttribute('name') || form.id || '',
      method: (form.getAttribute('method') || 'GET').toUpperCase(),
      action: form.getAttribute('action') || '',
      fields,
      submitHints: submitEl ? hintsFor(submitEl) : null,
    });
  }

  // Advanced component classification
  const CLASSIFIERS = [
    { type: 'button', sel: 'button, [role="button"], input[type="submit"], input[type="button"]' },
    { type: 'link', sel: 'a[href], [role="link"]' },
    { type: 'textbox', sel: 'input[type="text"], input[type="email"], input[type="password"], input[type="number"], input[type="search"], input:not([type]), textarea, [role="textbox"]' },
    { type: 'dropdown', sel: 'select, [role="combobox"], [role="listbox"], .oxd-select-text' },
    { type: 'checkbox', sel: 'input[type="checkbox"], [role="checkbox"]' },
    { type: 'radio', sel: 'input[type="radio"], [role="radio"]' },
    { type: 'table', sel: 'table, [role="grid"], [role="table"], .oxd-table' },
    { type: 'tab', sel: '[role="tab"], .oxd-tabs a, .oxd-topbar-body-nav-tab' },
    { type: 'dialog', sel: '[role="dialog"], .oxd-dialog-container, .orangehrm-dialog-modal' },
    { type: 'toast', sel: '[role="alert"], .oxd-toast' },
    { type: 'datepicker', sel: '.oxd-date-input, [role="grid"][aria-label*="calendar" i], input[placeholder*="yyyy" i]' },
    { type: 'fileupload', sel: 'input[type="file"]' },
    { type: 'accordion', sel: '[role="region"][aria-expanded], details, .oxd-accordion' },
    { type: 'chart', sel: 'canvas, svg[role="img"], .emp-distrib-chart' },
  ];
  const components = [];
  const seen = new WeakSet();
  for (const { type, sel } of CLASSIFIERS) {
    for (const el of Array.from(deepAll(sel))) {
      if (components.length >= maxComponents) break;
      if (seen.has(el)) continue;
      seen.add(el);
      const hints = hintsFor(el);
      components.push({
        type,
        role: el.getAttribute('role') || null,
        label: el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim().slice(0, 60) || null,
        visible: visible(el),
        enabled: !(el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'),
        required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
        selectorHints: hints,
        stability: stability(hints),
      });
    }
  }

  const links = Array.from(deepAll('a[href]')).map((a) => a.href).filter(Boolean);

  // Accessibility discovery — landmarks + interactive elements missing an accessible name.
  const LANDMARK_SEL = 'header, nav, main, footer, aside, [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"], [role="search"], [role="region"][aria-label]';
  const landmarks = [];
  for (const el of Array.from(deepAll(LANDMARK_SEL))) {
    landmarks.push({ role: el.getAttribute('role') || el.tagName.toLowerCase(), label: el.getAttribute('aria-label') || null });
  }
  let missingLabels = 0;
  for (const el of Array.from(deepAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"]'))) {
    const named = (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')
      || el.getAttribute('placeholder') || (el.textContent || '').trim() || (el.labels && el.labels.length));
    if (!named) missingLabels++;
  }

  return {
    forms, components, links, title: document.title || '',
    shadowRoots,
    a11y: { landmarks, missingLabels, keyboardFocusable: deepAll('[tabindex], a[href], button, input, select, textarea').length },
  };
}

/* istanbul ignore next — executes in the page context */
function harvestMenuInBrowser(selectors) {
  const out = new Set();
  for (const sel of selectors) {
    for (const a of Array.from(document.querySelectorAll(sel))) {
      if (a.href) out.add(a.href);
    }
  }
  return [...out];
}

// Dynamic content: repeatedly scroll to the bottom until the page height stops
// growing (infinite scroll / lazy load / virtualised grids) or a bound is hit.
/* istanbul ignore next — executes in the page context */
function autoScrollInBrowser({ steps, delay, maxPx }) {
  return new Promise((resolve) => {
    let i = 0; let last = -1; let stable = 0;
    const tick = () => {
      const h = document.body.scrollHeight;
      window.scrollTo(0, h);
      if (h === last) stable += 1; else stable = 0;
      last = h; i += 1;
      if (i >= steps || stable >= 2 || window.scrollY >= maxPx) {
        window.scrollTo(0, 0);
        resolve({ passes: i, finalHeight: h });
      } else { setTimeout(tick, delay); }
    };
    tick();
  });
}

// ── Authenticated login (robust; waits + verifies) ───────────────────────────
async function authenticate(page, cfg, baseUrl) {
  const loginUrl = `${baseUrl.replace(/\/+$/, '')}${cfg.loginPath}`;
  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: cfg.requestTimeoutMs });
    const user = page.locator('input[name="username"]');
    // WAIT for the form (React hydration) — do not sample visibility immediately.
    const appeared = await user.waitFor({ state: 'visible', timeout: cfg.requestTimeoutMs }).then(() => true).catch(() => false);
    if (!appeared) { logger.warn('[appCrawler] login form not shown — crawling unauthenticated'); return false; }
    await user.fill(String(cfg.username));
    await page.locator('input[name="password"]').fill(String(cfg.password));
    await page.locator('button[type="submit"]').click();
    if (cfg.verifyAuth) {
      const ok = await page.waitForURL(new RegExp(cfg.authenticatedUrlPattern, 'i'), { timeout: cfg.requestTimeoutMs })
        .then(() => true).catch(() => false);
      logger.info(`[appCrawler] authentication ${ok ? 'verified' : 'unverified'} — url=${page.url()}`);
      return ok;
    }
    await page.waitForLoadState('networkidle', { timeout: cfg.requestTimeoutMs }).catch(() => {});
    return true;
  } catch (e) {
    logger.warn(`[appCrawler] login error (continuing unauthenticated): ${e.message}`);
    return false;
  }
}

/**
 * Crawl an application and capture its surface.
 * @param {object} opts
 * @returns {Promise<{ target, appSurface, meta }>}
 */
async function crawl(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const baseUrl = cfg.baseUrl;
  if (!baseUrl) throw new Error('appCrawler.crawl requires a baseUrl');
  const allowedHosts = new Set(cfg.allowedHosts || [hostOf(baseUrl)]);
  const isCancelled = typeof cfg.isCancelled === 'function' ? cfg.isCancelled : () => false;
  const onProgress = typeof cfg.onProgress === 'function' ? cfg.onProgress : () => {};
  const nkey = (u) => normaliseUrl(u, { ignoreQuery: cfg.ignoreQuery });

  const t0 = Date.now();
  const browser = await chromium.launch({ headless: cfg.headless });
  // F1: guarantee Chromium cleanup on EVERY exit path (login/nav/extraction/timeout
  // errors). The original exception is never suppressed; cleanup failures log separately.
  try {
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: 1280, height: 720 },
    ...(cfg.storageState ? { storageState: cfg.storageState } : {}),
  });
  const page = await context.newPage();

  // ── Network capture ──
  const endpoints = [];
  const pendingTimings = new Map();
  page.on('request', (req) => pendingTimings.set(req, Date.now()));
  page.on('response', async (resp) => {
    try {
      const req = resp.request();
      const url = req.url();
      const rtype = req.resourceType();
      if (!['xhr', 'fetch', 'websocket', 'eventsource'].includes(rtype)) return;
      if (!isInScope(url, allowedHosts)) return;
      const startedAt = pendingTimings.get(req) || Date.now();
      let responseBody = null;
      const ct = (resp.headers()['content-type'] || '');
      if (/application\/(json|graphql)/i.test(ct)) {
        const txt = await resp.text().catch(() => '');
        if (txt && txt.length <= cfg.captureBodyMaxBytes) { try { responseBody = JSON.parse(txt); } catch { /* non-JSON */ } }
      }
      let requestBody = null;
      const post = req.postData();
      if (post && post.length <= cfg.captureBodyMaxBytes) { try { requestBody = JSON.parse(post); } catch { /* form-encoded */ } }
      const rawHeaders = req.headers();
      const requestHeaders = {};
      for (const [k, v] of Object.entries(rawHeaders)) {
        requestHeaders[k] = /^(authorization|cookie|x-api-key|x-auth-token)$/i.test(k) ? '[REDACTED]' : v;
      }
      endpoints.push({
        method: req.method(), url, kind: rtype,
        requestHeaders, requestBody, responseBody,
        status: resp.status(), durationMs: Date.now() - startedAt,
      });
    } catch { /* best-effort */ }
  });

  // ── Authenticate + seed ──
  let authenticated = false;
  if (cfg.username && cfg.password) authenticated = await authenticate(page, cfg, baseUrl);

  // Seed from the authenticated landing page (falls back to baseUrl).
  const seedUrl = authenticated ? nkey(page.url()) : nkey(baseUrl);

  const routes = [];
  const pages = [];
  const navEdges = [];
  const visited = new Set();
  const queue = [{ url: seedUrl, depth: 0, from: null }];
  // Phase-2 coverage accumulators
  let totalShadowRoots = 0, totalFrames = 0, totalMissingLabels = 0, totalLandmarks = 0;

  // If authenticated, harvest the SPA main-menu links up front (depth 1).
  if (authenticated) {
    try {
      const menu = await page.evaluate(harvestMenuInBrowser, cfg.menuSelectors);
      for (const m of menu) {
        const n = nkey(m);
        if (isInScope(n, allowedHosts)) queue.push({ url: n, depth: 1, from: seedUrl });
      }
      logger.info(`[appCrawler] seeded ${menu.length} SPA menu link(s)`);
    } catch (e) { logger.warn(`[appCrawler] menu harvest failed: ${e.message}`); }
  }

  const takeNext = () => (cfg.strategy === 'dfs' ? queue.pop() : queue.shift());

  while (queue.length && routes.length < cfg.maxPages) {
    if (isCancelled()) { logger.info('[appCrawler] cancellation requested — stopping crawl'); break; }
    const item = takeNext();
    const key = nkey(item.url);
    if (visited.has(key)) continue;                    // duplicate/cycle detection
    if (!isInScope(key, allowedHosts)) continue;
    visited.add(key);

    let statusCode = null;
    try {
      const resp = await page.goto(key, { waitUntil: 'domcontentloaded', timeout: cfg.requestTimeoutMs });
      statusCode = resp ? resp.status() : null;
      await page.waitForTimeout(cfg.navSettleMs);
    } catch (e) {
      logger.warn(`[appCrawler] nav failed ${key}: ${e.message}`);
      continue;
    }

    // Dynamic content: scroll to trigger lazy/infinite/virtualised loading.
    if (cfg.dynamicContent) {
      try { await page.evaluate(autoScrollInBrowser, { steps: cfg.scrollSteps, delay: cfg.scrollDelayMs, maxPx: cfg.maxScrollPx }); } catch { /* non-fatal */ }
      await page.waitForTimeout(Math.min(cfg.navSettleMs, 500));
    }

    let surface;
    try { surface = await page.evaluate(extractSurfaceInBrowser, cfg.maxComponentsPerPage); }
    catch { surface = { forms: [], components: [], links: [], title: '', shadowRoots: 0, a11y: { landmarks: [], missingLabels: 0, keyboardFocusable: 0 } }; }

    // iFrame discovery — evaluate same-origin frames and merge into the surface.
    let framesTraversed = 0;
    if (cfg.discoverIframes) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          const fs = await frame.evaluate(extractSurfaceInBrowser, cfg.maxComponentsPerPage);
          surface.forms.push(...fs.forms);
          surface.components.push(...fs.components.map((c) => ({ ...c, frame: frame.url() })));
          surface.links.push(...fs.links);
          surface.shadowRoots += fs.shadowRoots || 0;
          framesTraversed += 1;
        } catch { /* cross-origin or detached frame — skip */ }
      }
    }

    // The SPA may have client-side-redirected; record the settled URL.
    const settled = nkey(page.url());
    routes.push({ url: settled, path: pathOf(settled), title: surface.title, statusCode, depth: item.depth });
    if (surface.forms.length || surface.components.length) {
      pages.push({
        url: settled, path: pathOf(settled),
        forms: surface.forms, components: surface.components,
        a11y: surface.a11y, frames: framesTraversed, shadowRoots: surface.shadowRoots || 0,
      });
    }
    if (item.from) navEdges.push({ from: item.from, to: settled });
    totalShadowRoots += surface.shadowRoots || 0;
    totalFrames += framesTraversed;
    totalMissingLabels += surface.a11y ? surface.a11y.missingLabels : 0;
    totalLandmarks += surface.a11y ? surface.a11y.landmarks.length : 0;
    onProgress({ stage: 'crawl', routes: routes.length, url: settled });

    if (item.depth < cfg.maxDepth) {
      for (const link of surface.links) {
        const n = nkey(link);
        if (!visited.has(n) && isInScope(n, allowedHosts)) queue.push({ url: n, depth: item.depth + 1, from: settled });
      }
    }
  }

  // Cleanup is handled in the finally block below (F1) so it runs on every path.

  const componentCount = pages.reduce((s, p) => s + (p.components ? p.components.length : 0), 0);
  const durationMs = Date.now() - t0;
  // Stable content fingerprint (for incremental / differential discovery).
  const fingerprintBasis = routes.map((r) => r.path).sort().join('|') + '::' + endpoints.map((e) => `${e.method} ${pathOf(e.url)}`).sort().join('|');
  const fingerprint = fnv1a(fingerprintBasis);
  const meta = {
    crawlStats: {
      routes: routes.length,
      pagesWithForms: pages.filter((p) => p.forms && p.forms.length).length,
      pagesCaptured: pages.length,
      components: componentCount,
      endpoints: endpoints.length,
      navEdges: navEdges.length,
      shadowRoots: totalShadowRoots,
      framesTraversed: totalFrames,
      a11y: { landmarks: totalLandmarks, missingLabels: totalMissingLabels },
      authenticated,
      strategy: cfg.strategy,
      durationMs,
      maxDepth: cfg.maxDepth,
      maxPages: cfg.maxPages,
    },
    // Discovery analytics (machine-readable — feeds dashboards + delta reports).
    analytics: {
      pagesDiscovered: routes.length,
      componentsDiscovered: componentCount,
      apiEndpoints: endpoints.length,
      navigationEdges: navEdges.length,
      shadowRootsPierced: totalShadowRoots,
      iframesTraversed: totalFrames,
      accessibilityLandmarks: totalLandmarks,
      accessibilityMissingLabels: totalMissingLabels,
      crawlerEfficiencyPagesPerSec: durationMs > 0 ? Number((routes.length / (durationMs / 1000)).toFixed(3)) : 0,
      queueExhausted: queue.length === 0,
      pageBudgetUsedPct: Math.round((routes.length / cfg.maxPages) * 100),
      fingerprint,
    },
  };
  logger.info(`[appCrawler] crawl complete host=${hostOf(baseUrl)} auth=${authenticated} routes=${routes.length} pages=${pages.length} components=${componentCount} endpoints=${endpoints.length} edges=${navEdges.length} in ${meta.crawlStats.durationMs}ms`);

  return {
    target: { baseUrl, appName: cfg.appName || hostOf(baseUrl), discoveredAt: new Date().toISOString() },
    appSurface: {
      routes,
      pages,
      endpoints,
      navGraph: { nodes: routes.map((r) => r.url), edges: navEdges },
    },
    meta,
  };
  } finally {
    // F1: always release the browser; log (never throw) if teardown itself fails so the
    // original crawl error propagates unchanged.
    try { await browser.close(); } catch (e) { logger.warn(`[appCrawler] browser cleanup failed: ${e.message}`); }
  }
}

module.exports = { crawl, DEFAULTS, normaliseUrl, hostOf, pathOf, isInScope, fnv1a };
