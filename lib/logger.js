'use strict';
const fs      = require('fs');
const path    = require('path');
const winston = require('winston');
const { scrubString } = require('../middleware/pii-scrubber');

const LOG_DIR   = process.env.LOG_DIR   || 'logs';
const LEVEL     = process.env.LOG_LEVEL || 'info';
const MAX_SIZE  = parseInt(process.env.LOG_MAX_SIZE_BYTES || '10000000', 10);
const MAX_FILES = parseInt(process.env.LOG_MAX_FILES      || '5',        10);

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Redact PII from log lines — story titles/descriptions are logged and may contain
// SSNs, cards, emails, etc. Keeps the on-disk logs consistent with the PII posture.
const redactPII = winston.format((info) => {
  if (typeof info.message === 'string') info.message = scrubString(info.message);
  return info;
})();

module.exports = winston.createLogger({
  level: LEVEL,
  format: winston.format.combine(redactPII, winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: MAX_SIZE,
      maxFiles: MAX_FILES,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'execution-plane.log'),
      maxsize: MAX_SIZE,
      maxFiles: MAX_FILES,
      tailable: true,
    }),
  ],
});
