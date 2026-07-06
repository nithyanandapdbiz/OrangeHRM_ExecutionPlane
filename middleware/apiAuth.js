'use strict';
const crypto = require('crypto');

/**
 * Optional API-key gate for privileged endpoints (e.g. POST /run).
 *
 * WHY opt-in: `POST /run` is a privileged endpoint (writes to Jira/Zephyr, drives
 * a live app login). It must be authenticated in any shared/production deployment.
 * Enforcement is gated on API_SECRET so that local/dev usage keeps working until
 * a secret is provisioned — i.e. **deny-by-default once configured**, no breaking
 * change before. Set API_SECRET to require auth; scripts/trigger.js sends it
 * automatically when present.
 *
 * Accepts:  Authorization: Bearer <API_SECRET>   or   X-API-Key: <API_SECRET>
 * Constant-time comparison avoids timing side-channels.
 */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function apiAuth(req, res, next) {
  const secret = process.env.API_SECRET;
  if (!secret) return next(); // not configured → no-op (backward compatible)

  const header   = req.headers['authorization'] || '';
  const provided = String(req.headers['x-api-key'] || header.replace(/^Bearer\s+/i, '')).trim();

  if (provided && safeEqual(provided, secret)) return next();
  return res.status(401).json({
    error: 'Unauthorized — provide a valid X-API-Key or Authorization: Bearer <API_SECRET>',
  });
}

module.exports = { apiAuth };
