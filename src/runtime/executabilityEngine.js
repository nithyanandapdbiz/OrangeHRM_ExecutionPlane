'use strict';
/**
 * executabilityEngine.js — WI-037  Pre-Execution Feasibility & Environment Intelligence
 * ──────────────────────────────────────────────────────────────────────────────────────
 * Determines whether a generated scenario is actually runnable in the current
 * OrangeHRM environment BEFORE the browser is launched.
 *
 * Checks (in order of severity):
 *   Phase 2 — Module validation       module/page exists + enabled in metadata
 *   Phase 3 — Field validation        field exists on module in metadata
 *   Phase 4 — Page validation         required page/route exists in metadata
 *   Phase 5 — Security validation     CRUD permissions inferred from metadata
 *   Phase 6 — Test data validation    data-dependency warnings
 *   Phase 7 — Readiness score         weighted 0-100, banded to READY / READY_WITH_WARNINGS / BLOCKED
 *
 * Readiness bands:
 *   90-100  READY
 *   70-89   READY_WITH_WARNINGS
 *   0-69    BLOCKED
 *
 * Public API:
 *   analyzeScenario(scenario, metadata, options?)  → AnalysisResult
 *   analyzeStory(storyPath, metadata?, options?)   → StoryResult
 *   analyzeEnvironment()                           → EnvironmentResult
 *   writeTelemetry(entry)                          → void
 *   writeReadinessReport(result, storyId?)         → string (file path)
 *   scoreToReadiness(score)                        → 'READY'|'READY_WITH_WARNINGS'|'BLOCKED'
 *   computeScore(checks)                           → number (0-100)
 *   extractEntitiesFromScenario(scenario, metadata?) → string[]
 *   extractFieldsFromScenario(scenario, metadata?)   → FieldRef[]
 *   validateEntities(entities, metadata)            → EntityCheck
 *   validateFields(fields, entities, metadata)       → FieldCheck
 *   validateForms(forms, metadata)                   → FormCheck
 *   validatePermissions(entities, scenario)          → PermissionCheck
 *   validateTestData(scenario, options?)             → TestDataCheck
 *   parseFeatureFile(filePath)                       → ScenarioSpec[]
 *   READINESS_BANDS
 */

const fs   = require('fs');
const path = require('path');

const ROOT              = path.resolve(__dirname, '..', '..');
const TELEMETRY_FILE    = path.join(ROOT, 'logs',    'executability-analysis.jsonl');
const READINESS_REPORT  = path.join(ROOT, 'reports', 'executability-readiness.json');
const TRACKER_READINESS_FILE = path.join(ROOT, '.story-execution-readiness.json');

// ─── Constants ────────────────────────────────────────────────────────────────

const READINESS_BANDS = Object.freeze({
  READY:                { min: 90,  max: 100 },
  READY_WITH_WARNINGS:  { min: 70,  max: 89  },
  BLOCKED:              { min: 0,   max: 69  },
});

// OrangeHRM module display-name → module key mapping
const ENTITY_KEYWORDS = {
  dashboard:   ['dashboard', 'home', 'landing'],
  admin:       ['admin', 'user', 'users', 'user management'],
  pim:         ['pim', 'employee', 'employees', 'personnel'],
  leave:       ['leave', 'leaves', 'time off', 'absence'],
  time:        ['time', 'timesheet', 'timesheets', 'attendance'],
  recruitment: ['recruitment', 'candidate', 'candidates', 'vacancy'],
  myinfo:      ['my info', 'myinfo', 'personal details', 'my profile'],
  performance: ['performance', 'review', 'reviews', 'appraisal'],
  directory:   ['directory', 'org chart', 'colleagues'],
  maintenance: ['maintenance', 'data purge', 'archive'],
  buzz:        ['buzz', 'feed', 'social feed', 'posts'],
  claim:       ['claim', 'claims', 'expense', 'reimbursement'],
};

// Known field display names → module.logicalName
const KNOWN_FIELDS = {
  'first name':            { entity: 'pim',   logicalName: 'firstName' },
  'first':                 { entity: 'pim',   logicalName: 'firstName' },
  'middle name':           { entity: 'pim',   logicalName: 'middleName' },
  'last name':             { entity: 'pim',   logicalName: 'lastName' },
  'last':                  { entity: 'pim',   logicalName: 'lastName' },
  'employee id':           { entity: 'pim',   logicalName: 'employeeId' },
  'employee name':         { entity: 'admin', logicalName: 'employeeName' },
  'name':                  { entity: 'admin', logicalName: 'employeeName' },
  'username':              { entity: 'admin', logicalName: 'username' },
  'user name':             { entity: 'admin', logicalName: 'username' },
  'password':              { entity: 'admin', logicalName: 'password' },
  'user role':             { entity: 'admin', logicalName: 'userRole' },
  'role':                  { entity: 'admin', logicalName: 'userRole' },
  'status':                { entity: 'admin', logicalName: 'status' },
  'leave type':            { entity: 'leave', logicalName: 'leaveType' },
  'type':                  { entity: 'leave', logicalName: 'leaveType' },
  'from date':             { entity: 'leave', logicalName: 'fromDate' },
  'start date':            { entity: 'leave', logicalName: 'fromDate' },
  'to date':               { entity: 'leave', logicalName: 'toDate' },
  'end date':              { entity: 'leave', logicalName: 'toDate' },
};

// App operations → metadata permission mapping
const CRUD_KEYWORDS = {
  create: ['create', 'add', 'new', 'submit', 'save'],
  read:   ['view', 'open', 'navigate', 'see', 'read', 'display', 'shows', 'show'],
  update: ['update', 'edit', 'modify', 'change', 'fill', 'enter', 'set'],
  delete: ['delete', 'remove', 'deactivate', 'discard'],
};

// ─── Environment analysis (Phase 1) ──────────────────────────────────────────

/**
 * Analyze the current execution environment.
 * Checks environment variables, app metadata cache, and BDD artifact presence.
 *
 * @returns {{ valid: boolean, missingConfig: string[], metadataAvailable: boolean,
 *             hasBddArtifacts: boolean, baseUrl: string|null, warnings: string[] }}
 */
function analyzeEnvironment() {
  const missingConfig = [];
  const warnings      = [];

  const REQUIRED = ['APP_BASE_URL', 'APP_USERNAME', 'APP_PASSWORD'];
  const REQUIRED_FOR_TRACKER = ['JIRA_TOKEN', 'JIRA_BASE_URL', 'JIRA_PROJECT'];

  for (const v of REQUIRED) {
    if (!process.env[v]) missingConfig.push(v);
  }
  for (const v of REQUIRED_FOR_TRACKER) {
    if (!process.env[v]) missingConfig.push(v);
  }

  const metadataCacheFile = path.join(ROOT, '.cache', 'app-metadata.json');
  const metadataAvailable = fs.existsSync(metadataCacheFile);

  if (!metadataAvailable) {
    warnings.push('App metadata cache not found — feasibility checks will use keyword-based detection only');
  }

  const featuresDir  = path.join(ROOT, 'tests', 'features');
  const stepsDir     = path.join(ROOT, 'tests', 'step-definitions');
  const hasBddArtifacts = fs.existsSync(featuresDir) && fs.existsSync(stepsDir);

  if (!hasBddArtifacts) {
    warnings.push('BDD artifact directories not found (tests/features or tests/step-definitions)');
  }

  return {
    valid:             missingConfig.length === 0,
    missingConfig,
    metadataAvailable,
    hasBddArtifacts,
    baseUrl:           process.env.APP_BASE_URL || process.env.TEST_BASE_URL || null,
    warnings,
  };
}

// ─── Entity extraction (Phase 2 helper) ──────────────────────────────────────

/**
 * Extract OrangeHRM module keys referenced by a scenario.
 * Checks scenario title, step text, feature file path, and explicit entity property.
 *
 * @param {{ title: string, steps: string[], featureFile?: string, entity?: string }} scenario
 * @param {object} [metadata] — app metadata map (used for validation after detection)
 * @returns {string[]}  deduplicated array of module keys
 */
function extractEntitiesFromScenario(scenario, metadata) {
  const found   = new Set();
  const textBlob = [
    scenario.title || '',
    ...(scenario.steps || []),
    scenario.featureFile || '',
  ].join(' ').toLowerCase();

  // Explicit entity property set by generator
  if (scenario.entity) {
    found.add(scenario.entity.toLowerCase());
  }

  for (const [logicalName, keywords] of Object.entries(ENTITY_KEYWORDS)) {
    for (const kw of keywords) {
      // Word-boundary-aware match
      const pattern = new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(textBlob)) {
        found.add(logicalName);
        break;
      }
    }
  }

  return [...found];
}

// ─── Field extraction (Phase 3 helper) ───────────────────────────────────────

/**
 * Extract OrangeHRM field references referenced in a scenario.
 * Returns objects with { displayName, entity, logicalName } for each match.
 *
 * @param {{ title: string, steps: string[], featureFile?: string }} scenario
 * @param {object} [metadata]
 * @returns {{ displayName: string, entity: string, logicalName: string }[]}
 */
function extractFieldsFromScenario(scenario, metadata) {
  const found   = new Map(); // key → { displayName, entity, logicalName }
  const textBlob = [scenario.title || '', ...(scenario.steps || [])].join(' ');

  for (const [displayName, fieldInfo] of Object.entries(KNOWN_FIELDS)) {
    const pattern = new RegExp(`\\b${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(textBlob)) {
      const key = `${fieldInfo.entity}.${fieldInfo.logicalName}`;
      if (!found.has(key)) {
        found.set(key, { displayName, entity: fieldInfo.entity, logicalName: fieldInfo.logicalName });
      }
    }
  }

  // Also extract from metadata fields if metadata available
  if (metadata) {
    for (const [entityName, entityMeta] of Object.entries(metadata)) {
      for (const field of (entityMeta.fields || [])) {
        if (!field.displayName) continue;
        const pattern = new RegExp(`\\b${field.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (pattern.test(textBlob)) {
          const key = `${entityName}.${field.logicalName}`;
          if (!found.has(key)) {
            found.set(key, { displayName: field.displayName, entity: entityName, logicalName: field.logicalName });
          }
        }
      }
    }
  }

  return [...found.values()];
}

// ─── Form extraction (Phase 4 helper) ────────────────────────────────────────

/**
 * Extract page/form names referenced in a scenario.
 * Looks for patterns like "Add Employee Form", "Assign Leave Form", etc.
 *
 * @param {{ title: string, steps: string[] }} scenario
 * @param {object} [metadata]
 * @returns {{ name: string, entity: string }[]}
 */
function extractFormsFromScenario(scenario, metadata) {
  const found   = [];
  const textBlob = [scenario.title || '', ...(scenario.steps || [])].join(' ');

  // Match "X Form" / "X main form" / "X quick create form" patterns
  const formPattern = /(\w[\w\s]{1,40}?)\s+(main\s+form|quick\s+create\s+form|form)/gi;
  let m;
  while ((m = formPattern.exec(textBlob)) !== null) {
    const formName = m[0].trim();
    // Determine entity from form name prefix
    let entity = null;
    for (const [logicalName, keywords] of Object.entries(ENTITY_KEYWORDS)) {
      if (keywords.some(kw => formName.toLowerCase().startsWith(kw))) {
        entity = logicalName;
        break;
      }
    }
    if (entity) found.push({ name: formName, entity });
  }

  // Validate against metadata forms if available
  if (metadata) {
    for (const [entityName, entityMeta] of Object.entries(metadata)) {
      for (const form of (entityMeta.forms || [])) {
        if (!form.name) continue;
        if (textBlob.toLowerCase().includes(form.name.toLowerCase())) {
          if (!found.some(f => f.name.toLowerCase() === form.name.toLowerCase())) {
            found.push({ name: form.name, entity: entityName });
          }
        }
      }
    }
  }

  return found;
}

// ─── Validate entities (Phase 2) ─────────────────────────────────────────────

/**
 * Validate that required entities exist in metadata.
 *
 * @param {string[]} entities     — module keys to check
 * @param {object|null} metadata  — app metadata map
 * @returns {{ valid: boolean, found: string[], missing: string[], unknown: string[], warnings: string[] }}
 */
function validateEntities(entities, metadata) {
  if (!entities || entities.length === 0) {
    return { valid: true, found: [], missing: [], unknown: [], warnings: [] };
  }
  if (!metadata || Object.keys(metadata).length === 0) {
    return {
      valid: false,
      found:   [],
      missing: [],
      unknown: entities,
      warnings: entities.map(e => `Entity "${e}" could not be validated — metadata unavailable`),
    };
  }

  const found    = [];
  const missing  = [];
  const unknown  = [];
  const warnings = [];
  const metaKeys = Object.keys(metadata).map(k => k.toLowerCase());

  for (const entity of entities) {
    const lower = entity.toLowerCase();
    if (metaKeys.includes(lower)) {
      found.push(entity);
      // Check if entity is enabled (if metadata has that property)
      const meta = metadata[lower] || metadata[entity];
      if (meta && meta.enabled === false) {
        missing.push(entity);
        warnings.push(`Entity "${entity}" exists but is disabled`);
      }
    } else {
      missing.push(entity);
      warnings.push(`Module "${entity}" not found in app metadata`);
    }
  }

  return {
    valid:    missing.length === 0,
    found,
    missing,
    unknown,
    warnings,
  };
}

// ─── Validate fields (Phase 3) ────────────────────────────────────────────────

/**
 * Validate that required fields exist in metadata.
 *
 * @param {{ entity: string, logicalName: string, displayName: string }[]} fields
 * @param {string[]} entities
 * @param {object|null} metadata
 * @returns {{ valid: boolean, found: string[], missing: string[], warnings: string[] }}
 */
function validateFields(fields, entities, metadata) {
  if (!fields || fields.length === 0) {
    return { valid: true, found: [], missing: [], warnings: [] };
  }
  if (!metadata || Object.keys(metadata).length === 0) {
    return {
      valid:    false,
      found:    [],
      missing:  [],
      warnings: ['Field validation skipped — metadata unavailable'],
    };
  }

  const found    = [];
  const missing  = [];
  const warnings = [];

  for (const field of fields) {
    const entityMeta = metadata[field.entity?.toLowerCase()] || metadata[field.entity];
    if (!entityMeta) {
      warnings.push(`Field "${field.displayName}" — entity "${field.entity}" not in metadata`);
      continue;
    }
    const metaFields = entityMeta.fields || [];
    const exists = metaFields.some(f =>
      (f.logicalName || '').toLowerCase() === field.logicalName.toLowerCase() ||
      (f.displayName || '').toLowerCase() === field.displayName.toLowerCase()
    );
    if (exists) {
      found.push(`${field.entity}.${field.logicalName}`);
    } else {
      missing.push(`${field.entity}.${field.logicalName}`);
      warnings.push(`Field "${field.displayName}" (${field.entity}.${field.logicalName}) not found in metadata`);
    }
  }

  return { valid: missing.length === 0, found, missing, warnings };
}

// ─── Validate forms (Phase 4) ─────────────────────────────────────────────────

/**
 * Validate that required forms exist in metadata.
 *
 * @param {{ name: string, entity: string }[]} forms
 * @param {object|null} metadata
 * @returns {{ valid: boolean, found: string[], missing: string[], warnings: string[] }}
 */
function validateForms(forms, metadata) {
  if (!forms || forms.length === 0) {
    return { valid: true, found: [], missing: [], warnings: [] };
  }
  if (!metadata || Object.keys(metadata).length === 0) {
    return {
      valid:    true, // don't block on form validation without metadata
      found:    [],
      missing:  [],
      warnings: ['Form validation skipped — metadata unavailable'],
    };
  }

  const found    = [];
  const missing  = [];
  const warnings = [];

  for (const form of forms) {
    const entityMeta = metadata[form.entity?.toLowerCase()] || metadata[form.entity];
    if (!entityMeta) {
      warnings.push(`Form "${form.name}" — entity "${form.entity}" not in metadata`);
      continue;
    }
    const metaForms = entityMeta.forms || [];
    const exists = metaForms.some(f =>
      (f.name || '').toLowerCase().includes(form.name.toLowerCase()) ||
      form.name.toLowerCase().includes((f.name || '').toLowerCase())
    );
    if (exists) {
      found.push(form.name);
    } else {
      missing.push(form.name);
      warnings.push(`Form "${form.name}" not found in metadata for entity "${form.entity}"`);
    }
  }

  return { valid: missing.length === 0, found, missing, warnings };
}

// ─── Validate permissions (Phase 5) ──────────────────────────────────────────

/**
 * Validate that the scenario's required app operations are likely permitted.
 * Since live permission checks require auth, this performs keyword-based inference
 * and emits warnings for high-risk operations (delete, admin-level changes).
 *
 * @param {string[]} entities   — required entities
 * @param {{ title: string, steps: string[] }} scenario
 * @returns {{ valid: boolean, requiredOps: string[], concerns: string[], warnings: string[] }}
 */
function validatePermissions(entities, scenario) {
  const textBlob  = [scenario.title || '', ...(scenario.steps || [])].join(' ').toLowerCase();
  const requiredOps = new Set();
  const concerns    = [];
  const warnings    = [];

  for (const [op, keywords] of Object.entries(CRUD_KEYWORDS)) {
    if (keywords.some(kw => textBlob.includes(kw))) {
      requiredOps.add(op);
    }
  }

  // Flag delete operations as high-concern
  if (requiredOps.has('delete')) {
    concerns.push('delete-permission-required');
    warnings.push('Scenario requires Delete permission — verify user has Delete role for required entities');
  }

  // Flag create with multiple entities as moderate-concern
  if (requiredOps.has('create') && entities.length > 2) {
    concerns.push('multi-entity-create');
    warnings.push(`Scenario creates multiple entities (${entities.join(', ')}) — verify user has Create rights for all`);
  }

  return {
    valid:       concerns.length === 0,
    requiredOps: [...requiredOps],
    concerns,
    warnings,
  };
}

// ─── Validate test data (Phase 6) ─────────────────────────────────────────────

/**
 * Detect test-data dependencies in the scenario text.
 * Looks for named records: "Acme Corp account", "John Doe contact", etc.
 *
 * @param {{ title: string, steps: string[] }} scenario
 * @param {object} [options]
 * @returns {{ valid: boolean, dependencies: string[], missing: string[], warnings: string[] }}
 */
function validateTestData(scenario, options = {}) {
  const textBlob  = [scenario.title || '', ...(scenario.steps || [])].join(' ');
  const deps      = [];
  const warnings  = [];

  // Named record references: quoted strings or "a specific X"
  const quotedPattern = /"([^"]{3,50})"|'([^']{3,50})'/g;
  let m;
  while ((m = quotedPattern.exec(textBlob)) !== null) {
    const ref = (m[1] || m[2] || '').trim();
    // Only flag if it looks like a record name (CamelCase or multi-word with caps)
    if (/[A-Z]/.test(ref) && ref.length > 4) {
      deps.push(ref);
    }
  }

  // Specific data dependency keywords
  const dataKeywords = ['test employee', 'sample employee', 'reference data', 'existing record', 'precondition'];
  for (const kw of dataKeywords) {
    if (textBlob.toLowerCase().includes(kw)) {
      deps.push(kw);
      warnings.push(`Scenario references "${kw}" — ensure test data exists in target environment`);
    }
  }

  return {
    valid:        true, // data issues are warnings, not blockers
    dependencies: [...new Set(deps)],
    missing:      [], // cannot determine missing data without live DB access
    warnings,
  };
}

// ─── Score computation (Phase 7) ─────────────────────────────────────────────

/**
 * Compute a 0-100 readiness score from the checks object.
 * Each check category carries a maximum penalty that it can subtract.
 *
 * Penalty weights:
 *   entities:    -20 per missing (max -30 total)
 *   fields:      -5  per missing (max -20 total)
 *   forms:       -15 per missing (max -20 total)
 *   permissions: -7  per concern (max -15 total)
 *   environment: -3  per missing (max -10 total)
 *   testData:    -2  per missing (max -5 total)
 *
 * @param {object} checks  — { entities, fields, forms, permissions, environment, testData }
 * @returns {number} integer 0-100
 */
function computeScore(checks) {
  if (!checks || Object.keys(checks).length === 0) return 100;

  let score = 100;

  const entityMissing = (checks.entities?.missing?.length || 0) + (checks.entities?.unknown?.length || 0) * 0.5;
  score -= Math.min(30, Math.round(entityMissing * 20));

  const fieldMissing  = checks.fields?.missing?.length || 0;
  score -= Math.min(20, fieldMissing * 5);

  const formMissing   = checks.forms?.missing?.length || 0;
  score -= Math.min(20, formMissing * 15);

  const permConcerns  = checks.permissions?.concerns?.length || 0;
  score -= Math.min(15, permConcerns * 7);

  const envMissing    = checks.environment?.missing?.length || 0;
  score -= Math.min(10, envMissing * 3);

  const dataMissing   = checks.testData?.missing?.length || 0;
  score -= Math.min(5, dataMissing * 2);

  return Math.max(0, Math.round(score));
}

/**
 * Convert a numeric score to a readiness band string.
 *
 * @param {number} score  — 0-100
 * @returns {'READY'|'READY_WITH_WARNINGS'|'BLOCKED'}
 */
function scoreToReadiness(score) {
  if (score >= 90) return 'READY';
  if (score >= 70) return 'READY_WITH_WARNINGS';
  return 'BLOCKED';
}

// ─── Scenario analysis (Phase 1) ─────────────────────────────────────────────

/**
 * Analyze a single scenario for execution feasibility.
 *
 * @param {{ title: string, steps: string[], featureFile?: string, entity?: string, tags?: string[] }} scenario
 * @param {object|null} [metadata] — app metadata map from metadataCache
 * @param {object}      [options]
 * @returns {AnalysisResult}
 */
function analyzeScenario(scenario, metadata, options = {}) {
  const t0       = Date.now();
  const blockers = [];
  const warnings = [];

  // Extract required resources
  const entities = extractEntitiesFromScenario(scenario, metadata);
  const fields   = extractFieldsFromScenario(scenario, metadata);
  const forms    = extractFormsFromScenario(scenario, metadata);

  // Run all validation checks
  const entityCheck = validateEntities(entities, metadata);
  const fieldCheck  = validateFields(fields, entities, metadata);
  const formCheck   = validateForms(forms, metadata);
  const permCheck   = validatePermissions(entities, scenario);
  const dataCheck   = validateTestData(scenario, options);

  // Collect blockers and warnings from checks
  if (!entityCheck.valid) {
    for (const m of entityCheck.missing) {
      blockers.push({ type: 'entity_missing', entity: m, message: `Required module "${m}" not found or disabled in app metadata` });
    }
  }
  warnings.push(...(entityCheck.warnings || []));

  warnings.push(...(fieldCheck.warnings || []));
  if (fieldCheck.missing?.length > 0) {
    for (const f of fieldCheck.missing) {
      warnings.push(`Field "${f}" referenced in scenario is not in metadata`);
    }
  }

  if (!formCheck.valid) {
    for (const m of formCheck.missing) {
      blockers.push({ type: 'form_missing', form: m, message: `Required page "${m}" not found in app metadata` });
    }
  }
  warnings.push(...(formCheck.warnings || []));
  warnings.push(...(permCheck.warnings || []));
  warnings.push(...(dataCheck.warnings || []));

  // Environment check
  const envResult   = analyzeEnvironment();
  const envCheckData = {
    valid:   envResult.missingConfig.length === 0,
    missing: envResult.missingConfig,
    warnings: envResult.warnings,
  };
  warnings.push(...(envCheckData.warnings || []));

  const checks = {
    entities:    entityCheck,
    fields:      fieldCheck,
    forms:       formCheck,
    permissions: permCheck,
    environment: envCheckData,
    testData:    dataCheck,
  };

  const score      = computeScore(checks);
  const readiness  = scoreToReadiness(score);
  const executable = readiness !== 'BLOCKED';
  const confidence = Math.round((score / 100) * 100) / 100;

  return {
    executable,
    confidence,
    score,
    readiness,
    blockers,
    warnings: [...new Set(warnings)],
    requiredEntities: entities,
    requiredFields:   fields.map(f => `${f.entity}.${f.logicalName}`),
    checks,
    durationMs: Date.now() - t0,
  };
}

// ─── Story analysis (Phase 1) ─────────────────────────────────────────────────

/**
 * Analyze all scenarios in a story for execution feasibility.
 *
 * @param {string}      storyPath  — path to .story-testcases.json OR a .feature file
 * @param {object|null} [metadata] — app metadata map
 * @param {object}      [options]
 * @returns {StoryResult}
 */
function analyzeStory(storyPath, metadata, options = {}) {
  let scenarios = [];

  if (storyPath && fs.existsSync(storyPath)) {
    const ext = path.extname(storyPath).toLowerCase();
    if (ext === '.feature') {
      scenarios = parseFeatureFile(storyPath);
    } else {
      // Assume JSON story file
      try {
        const raw = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
        if (Array.isArray(raw)) {
          scenarios = raw.map(tc => ({
            title:       tc.title || tc.name || '(unnamed)',
            steps:       (tc.steps || []).map(s => typeof s === 'string' ? s : (s.action || s.text || '')),
            featureFile: tc.featureFile || storyPath,
            entity:      tc.entity || null,
            tags:        tc.tags   || [],
          }));
        }
      } catch { /* fall through with empty scenarios */ }
    }
  }

  // Analyze each scenario
  const results = scenarios.map(sc => {
    const analysis = analyzeScenario(sc, metadata, options);
    return { title: sc.title, featureFile: sc.featureFile, tags: sc.tags || [], ...analysis };
  });

  // Aggregate
  const scores      = results.map(r => r.score);
  const avgScore    = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 100;

  const allBlockers = results.flatMap(r => r.blockers);
  const allWarnings = [...new Set(results.flatMap(r => r.warnings))];
  const allExecutable = results.length === 0 || results.every(r => r.executable);

  const storyResult = {
    storyPath,
    score:       avgScore,
    readiness:   scoreToReadiness(avgScore),
    executable:  allExecutable,
    blockers:    allBlockers,
    warnings:    allWarnings,
    scenarios:   results,
    scenarioCount: results.length,
    generatedAt: new Date().toISOString(),
  };

  // Write readiness report (Phase 8 Jira integration)
  try { writeReadinessReport(storyResult, options.storyId); } catch { /* non-critical */ }

  return storyResult;
}

// ─── Feature file parser ──────────────────────────────────────────────────────

/**
 * Parse a Cucumber .feature file into an array of scenario specs.
 *
 * @param {string} filePath — absolute path to .feature file
 * @returns {{ title: string, steps: string[], featureFile: string }[]}
 */
function parseFeatureFile(filePath) {
  if (!fs.existsSync(filePath)) return [];

  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); }
  catch { return []; }

  const scenarios    = [];
  let currentScenario = null;
  let pendingTags    = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    if (/^Scenario(\s+Outline)?\s*:/i.test(line)) {
      if (currentScenario) scenarios.push(currentScenario);
      const title = line.replace(/^Scenario(\s+Outline)?\s*:\s*/i, '').trim();
      currentScenario = { title, steps: [], featureFile: filePath, tags: [...pendingTags] };
      pendingTags = [];
    } else if (/^@\w/.test(line)) {
      const tags = line.split(/\s+/).filter(t => t.startsWith('@'));
      pendingTags.push(...tags);
    } else if (/^(Given|When|Then|And|But)\s+/i.test(line) && currentScenario) {
      currentScenario.steps.push(line);
    }
  }

  if (currentScenario) scenarios.push(currentScenario);
  return scenarios;
}

// ─── Telemetry (Phase 11) ─────────────────────────────────────────────────────

/**
 * Append one entry to logs/executability-analysis.jsonl.
 *
 * @param {object} entry — { timestamp, entity, field, permissions, readiness, confidence, blockers }
 */
function writeTelemetry(entry) {
  try {
    const dir = path.dirname(TELEMETRY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(TELEMETRY_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch { /* non-critical */ }
}

// ─── Readiness report (Phase 8 Jira integration) ──────────────────────────────

/**
 * Write the readiness report to:
 *   reports/executability-readiness.json  (detailed)
 *   .story-execution-readiness.json       (Jira-linkable summary)
 *
 * @param {object}      result   — output from analyzeStory or analyzeScenario
 * @param {string|null} [storyId]
 * @returns {string} path to the Jira-linkable report
 */
function writeReadinessReport(result, storyId) {
  const summary = {
    storyId:      storyId || null,
    score:        result.score,
    readiness:    result.readiness,
    executable:   result.executable,
    blockerCount: (result.blockers || []).length,
    warningCount: (result.warnings || []).length,
    scenarioCount: result.scenarioCount ?? (result.scenarios?.length ?? 0),
    generatedAt:  result.generatedAt || new Date().toISOString(),
  };

  // Detailed report
  try {
    const dir = path.dirname(READINESS_REPORT);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let existing = [];
    if (fs.existsSync(READINESS_REPORT)) {
      try { existing = JSON.parse(fs.readFileSync(READINESS_REPORT, 'utf8')); if (!Array.isArray(existing)) existing = []; }
      catch { existing = []; }
    }
    existing.push({ ...summary, blockers: result.blockers, warnings: result.warnings });
    if (existing.length > 50) existing = existing.slice(-50);
    fs.writeFileSync(READINESS_REPORT, JSON.stringify(existing, null, 2), 'utf8');
  } catch { /* non-critical */ }

  // Jira-linkable summary
  try {
    const dir = path.dirname(TRACKER_READINESS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TRACKER_READINESS_FILE, JSON.stringify(summary, null, 2), 'utf8');
  } catch { /* non-critical */ }

  return TRACKER_READINESS_FILE;
}

// ─── App process feasibility check (WI-038B Phase 9) ─────────────────────────

// Known OrangeHRM process definitions for route/flow-specific validation
const APP_PROCESS_DEFINITIONS = {
  EmployeeLoginAddEmployee: {
    modules: ['dashboard', 'pim'],
    steps:   ['Login', 'Navigate to PIM', 'Add Employee', 'Save'],
    actions: ['Login', 'SaveEmployee'],
  },
};

/**
 * Analyze whether a named OrangeHRM process is feasible in the current environment.
 * Validates module availability via metadata cache; route and action availability
 * cannot be verified without a browser session.
 *
 * @param {string}      processName — key in APP_PROCESS_DEFINITIONS
 * @param {object|null} [metadata]  — app metadata map from metadataCache
 * @returns {{
 *   valid: boolean, processName: string,
 *   dashboardModule: boolean, pimModule: boolean,
 *   routeSettled: boolean|null,
 *   readiness: 'READY'|'READY_WITH_WARNINGS'|'BLOCKED',
 *   checks: object
 * }}
 */
function analyzeAppProcess(processName, metadata) {
  const definition = APP_PROCESS_DEFINITIONS[processName];
  if (!definition) {
    return {
      valid:            false,
      processName,
      dashboardModule:  false,
      pimModule:        false,
      routeSettled:     null,
      readiness:        'BLOCKED',
      reason:           `Unknown app process: "${processName}". Known: ${Object.keys(APP_PROCESS_DEFINITIONS).join(', ')}`,
      checks:           {},
    };
  }

  const moduleChecks = {};
  let allModulesFound = true;

  for (const moduleName of definition.modules) {
    const found = metadata
      ? !!(
          (metadata.modules || []).find(m =>
            (m.name || m.moduleName || '').toLowerCase() === moduleName
          )
        )
      : null; // null = unknown (no metadata available)
    moduleChecks[moduleName] = found;
    if (found === false) allModulesFound = false;
  }

  // Route settling — can only be confirmed with live metadata or browser session
  const routeAvailable = metadata?.routes
    ? metadata.routes.length > 0
    : null;

  const readiness = (!metadata || allModulesFound)
    ? (routeAvailable === false ? 'READY_WITH_WARNINGS' : 'READY')
    : 'BLOCKED';

  const result = {
    valid:            allModulesFound !== false,
    processName,
    dashboardModule:  moduleChecks.dashboard ?? true,
    pimModule:        moduleChecks.pim       ?? true,
    routeSettled:     routeAvailable,
    steps:            definition.steps,
    readiness,
    checks: {
      modules: moduleChecks,
      route:   { available: routeAvailable, steps: definition.steps },
      actions: Object.fromEntries(definition.actions.map(a => [a, null])),
    },
  };

  writeTelemetry({
    timestamp:   new Date().toISOString(),
    processName,
    readiness:   result.readiness,
    dashboardModule: result.dashboardModule,
    pimModule:   result.pimModule,
    metadataAvailable: !!metadata,
  });

  return result;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  analyzeScenario,
  analyzeStory,
  analyzeEnvironment,
  analyzeAppProcess,
  writeTelemetry,
  writeReadinessReport,
  scoreToReadiness,
  computeScore,
  extractEntitiesFromScenario,
  extractFieldsFromScenario,
  extractFormsFromScenario,
  validateEntities,
  validateFields,
  validateForms,
  validatePermissions,
  validateTestData,
  parseFeatureFile,
  READINESS_BANDS,
  ENTITY_KEYWORDS,
  KNOWN_FIELDS,
  APP_PROCESS_DEFINITIONS,
  TELEMETRY_FILE,
  READINESS_REPORT,
  TRACKER_READINESS_FILE,
};
