'use strict';
/**
 * schemas.js — lightweight, zero-dependency schema validators for agent outputs.
 *
 * Each `validate*` function returns `{ valid: boolean, errors: string[] }`.
 * Each `sanitize*` function returns a new object with defaults filled in for
 * missing or invalid fields. Sanitising NEVER throws and is safe to run on
 * any object (including null / undefined).
 *
 * @typedef  {object}  PlannerOutput
 * @property {string}              scope
 * @property {string[]}            testTypes
 * @property {string[]}            designTechniques
 * @property {string[]}            criticalScenarios
 * @property {string[]}            risks
 * @property {number}              confidence     - 0..1
 *
 * @typedef  {object}  QATestCase
 * @property {string}              title
 * @property {string}              description
 * @property {string}              [designTechnique]
 * @property {Array<string|object>} steps
 * @property {string}              expected
 * @property {('High'|'Normal'|'Low')} priority
 * @property {string[]}            tags
 *
 * @typedef {QATestCase[]}         QAOutput
 *
 * @typedef {QATestCase[]}         ReviewerOutput
 *
 * @typedef  {object}  RiskScore
 * @property {number}  businessImpact
 * @property {number}  failureLikelihood
 * @property {number}  defectSeverity
 * @property {number}  compositeRisk
 * @property {string}  reasoning
 *
 * @typedef  {QATestCase & { riskScore: RiskScore }} PrioritizedCase
 * @typedef  {PrioritizedCase[]}   RiskPrioritizerOutput
 *
 * @typedef  {object}  ExecutorOutput
 * @property {Array<{id: (string|number), key: string}>} createdKeys
 */

// ─── Tiny primitives ───────────────────────────────────────────────
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isStringArray(v)    { return Array.isArray(v) && v.every(x => typeof x === 'string'); }

// ─── PlannerOutput ─────────────────────────────────────────────────
function validatePlannerOutput(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['planner output is not an object'] };
  }
  if (!isNonEmptyString(obj.scope))               errors.push('scope must be a non-empty string');
  if (!isStringArray(obj.testTypes) || obj.testTypes.length === 0) errors.push('testTypes must be a non-empty string[]');
  if (!isStringArray(obj.designTechniques))       errors.push('designTechniques must be a string[]');
  if (!isStringArray(obj.criticalScenarios))      errors.push('criticalScenarios must be a string[]');
  if (!isStringArray(obj.risks))                  errors.push('risks must be a string[]');
  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
    errors.push('confidence must be a number in [0, 1]');
  }
  return { valid: errors.length === 0, errors };
}

function sanitizePlannerOutput(obj) {
  const o = (obj && typeof obj === 'object') ? obj : {};
  return {
    scope:             isNonEmptyString(o.scope) ? o.scope : 'Test all aspects of the story',
    testTypes:         isStringArray(o.testTypes) && o.testTypes.length > 0 ? o.testTypes : ['Happy Path', 'Negative'],
    designTechniques:  isStringArray(o.designTechniques) && o.designTechniques.length > 0 ? o.designTechniques : ['Equivalence Partitioning', 'Error Guessing'],
    criticalScenarios: isStringArray(o.criticalScenarios) ? o.criticalScenarios : [],
    risks:             isStringArray(o.risks) ? o.risks : ['Unexpected system behaviour with boundary inputs'],
    confidence:        (typeof o.confidence === 'number' && o.confidence >= 0 && o.confidence <= 1) ? o.confidence : 0
  };
}

// ─── QATestCase ────────────────────────────────────────────────────
const VALID_PRIORITIES = ['High', 'Normal', 'Low'];
function validateQATestCase(tc, idx = 0) {
  const errors = [];
  if (!tc || typeof tc !== 'object') return { valid: false, errors: [`case #${idx}: not an object`] };
  if (!isNonEmptyString(tc.title))       errors.push(`case #${idx}: title must be a non-empty string`);
  if (!isNonEmptyString(tc.description)) errors.push(`case #${idx}: description must be a non-empty string`);
  if (!Array.isArray(tc.steps) || tc.steps.length < 3) errors.push(`case #${idx}: steps must be an array with >= 3 entries`);
  if (!isNonEmptyString(tc.expected))    errors.push(`case #${idx}: expected must be a non-empty string`);
  if (!VALID_PRIORITIES.includes(tc.priority)) errors.push(`case #${idx}: priority must be High|Normal|Low`);
  if (!isStringArray(tc.tags))           errors.push(`case #${idx}: tags must be a string[]`);
  return { valid: errors.length === 0, errors };
}

function sanitizeQATestCase(tc) {
  const o = (tc && typeof tc === 'object') ? tc : {};
  const steps = Array.isArray(o.steps) ? [...o.steps] : [];
  while (steps.length < 3) steps.push(`Step ${steps.length + 1}: execute the test action`);
  return {
    ...o,
    title:       isNonEmptyString(o.title) ? o.title : 'Untitled test case',
    description: isNonEmptyString(o.description) ? o.description : 'Auto-sanitised description',
    steps,
    expected:    isNonEmptyString(o.expected) ? o.expected : 'The operation completes successfully without errors.',
    priority:    VALID_PRIORITIES.includes(o.priority) ? o.priority : 'Normal',
    tags:        isStringArray(o.tags) ? o.tags.map(t => String(t).toLowerCase()) : []
  };
}

// ─── QAOutput = QATestCase[] ──────────────────────────────────────
function validateQAOutput(arr) {
  if (!Array.isArray(arr)) return { valid: false, errors: ['QA output is not an array'] };
  const errors = [];
  arr.forEach((tc, i) => {
    const r = validateQATestCase(tc, i);
    if (!r.valid) errors.push(...r.errors);
  });
  return { valid: errors.length === 0, errors };
}

function sanitizeQAOutput(arr) {
  return (Array.isArray(arr) ? arr : []).map(sanitizeQATestCase);
}

// ─── ReviewerOutput = QATestCase[] (same shape post-enrichment) ───
const validateReviewerOutput = validateQAOutput;
const sanitizeReviewerOutput = sanitizeQAOutput;

// ─── RiskPrioritizerOutput = QATestCase[] with riskScore attached ─
function validateRiskPrioritizerOutput(arr) {
  if (!Array.isArray(arr)) return { valid: false, errors: ['Risk output is not an array'] };
  const errors = [];
  arr.forEach((tc, i) => {
    const base = validateQATestCase(tc, i);
    if (!base.valid) errors.push(...base.errors);
    if (!tc || typeof tc !== 'object' || !tc.riskScore || typeof tc.riskScore !== 'object') {
      errors.push(`case #${i}: riskScore must be an object`);
      return;
    }
    const rs = tc.riskScore;
    ['businessImpact', 'failureLikelihood', 'defectSeverity', 'compositeRisk'].forEach(k => {
      if (typeof rs[k] !== 'number' || rs[k] < 0 || rs[k] > 10) {
        errors.push(`case #${i}: riskScore.${k} must be number in [0, 10]`);
      }
    });
  });
  return { valid: errors.length === 0, errors };
}

function sanitizeRiskPrioritizerOutput(arr) {
  return (Array.isArray(arr) ? arr : []).map((tc, i) => {
    const base = sanitizeQATestCase(tc);
    const rs = (tc && tc.riskScore && typeof tc.riskScore === 'object') ? tc.riskScore : {};
    return {
      ...base,
      riskScore: {
        businessImpact:    typeof rs.businessImpact === 'number' ? rs.businessImpact : 5,
        failureLikelihood: typeof rs.failureLikelihood === 'number' ? rs.failureLikelihood : 5,
        defectSeverity:    typeof rs.defectSeverity === 'number' ? rs.defectSeverity : 5,
        compositeRisk:     typeof rs.compositeRisk === 'number' ? rs.compositeRisk : 5,
        reasoning:         isNonEmptyString(rs.reasoning) ? rs.reasoning : `Auto-assigned default (index ${i})`
      }
    };
  });
}

// ─── ExecutorOutput ───────────────────────────────────────────────
function validateExecutorOutput(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['executor output not an object'] };
  if (!Array.isArray(obj.createdKeys)) errors.push('createdKeys must be an array');
  else {
    obj.createdKeys.forEach((x, i) => {
      if (!x || typeof x !== 'object')  errors.push(`createdKeys[${i}]: not an object`);
      else if (!isNonEmptyString(x.key)) errors.push(`createdKeys[${i}]: key must be a non-empty string`);
    });
  }
  return { valid: errors.length === 0, errors };
}

function sanitizeExecutorOutput(obj) {
  const o = (obj && typeof obj === 'object') ? obj : {};
  return {
    createdKeys: Array.isArray(o.createdKeys)
      ? o.createdKeys.filter(x => x && typeof x === 'object' && isNonEmptyString(x.key))
      : []
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Dev-Change Reconciliation (Section 23) — agent output schemas
// ════════════════════════════════════════════════════════════════════════════
// All seven dev-change agents follow the same convention used above:
//   - validate*() returns { valid, errors[] } and never throws.
//   - sanitize*() returns a complete object with safe defaults; never throws.
// These are additive — existing exports below are byte-identical.

const VALID_SURFACES         = ['ui', 'api', 'data', 'config', 'infra', 'test'];
const VALID_OVERALL_RISK     = ['low', 'medium', 'high', 'critical'];
const VALID_COVERAGE_TYPES   = ['full', 'partial', 'tangential'];
const VALID_DISCOVERY_DECISIONS = ['update', 'augment', 'supersede', 'leave_alone'];
const VALID_AUTHORING_TYPES  = ['new_spec', 'patch_spec', 'new_zephyr_testcase', 'update_zephyr_testcase'];
const VALID_REFLECTION_VERDICTS = ['real_bug', 'flaky', 'bad_test', 'environmental', 'expected_pass'];
const VALID_REFLECTION_ACTIONS  = ['create_jira_bug', 'mark_flaky', 'flag_for_review', 'no_action'];
const VALID_CROSSRUN_PATTERNS   = ['first_failure', 'recurring', 'degrading', 'flaky', 'correlated_outage'];
const VALID_ATTACK_VECTORS = [
  'data_boundary', 'race_condition', 'state_machine_violation',
  'concurrency', 'unicode_edge', 'time_dependent',
  'resource_exhaustion', 'partial_failure', 'replay',
  'fair_lending_proxy', 'npi_leak', 'audit_gap'
];
const VALID_ATTACK_SEVERITY = ['critical', 'high', 'medium', 'low'];
const VALID_CRITIC_SEVERITY = ['must_fix', 'should_fix', 'nitpick'];

function isUnitInterval(v) { return typeof v === 'number' && v >= 0 && v <= 1; }
function isInEnum(v, enumArr) { return typeof v === 'string' && enumArr.includes(v); }

// ─── Agent 1: changeIntelligence ───────────────────────────────────────────
function validateChangeIntelligenceOutput(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['changeIntelligence output not an object'] };
  if (!Array.isArray(obj.changes))                 errors.push('changes must be an array');
  else obj.changes.forEach((c, i) => {
    if (!c || typeof c !== 'object')                       { errors.push(`changes[${i}] not an object`); return; }
    if (!isNonEmptyString(c.id))                            errors.push(`changes[${i}].id required`);
    if (!isNonEmptyString(c.intent))                        errors.push(`changes[${i}].intent required`);
    if (!isInEnum(c.surface, VALID_SURFACES))               errors.push(`changes[${i}].surface invalid`);
    if (typeof c.breakingChange !== 'boolean')              errors.push(`changes[${i}].breakingChange must be boolean`);
    if (!isStringArray(c.affectedUserFlows))                errors.push(`changes[${i}].affectedUserFlows must be string[]`);
    if (!isStringArray(c.affectedComponents))               errors.push(`changes[${i}].affectedComponents must be string[]`);
    if (!isStringArray(c.affectedPOMs))                     errors.push(`changes[${i}].affectedPOMs must be string[]`);
    if (!isStringArray(c.riskFactors))                      errors.push(`changes[${i}].riskFactors must be string[]`);
    if (!isStringArray(c.suggestedCoverage))                errors.push(`changes[${i}].suggestedCoverage must be string[]`);
    if (!isStringArray(c.suggestedTestTypes))               errors.push(`changes[${i}].suggestedTestTypes must be string[]`);
    if (!isUnitInterval(c.confidence))                      errors.push(`changes[${i}].confidence must be 0..1`);
  });
  if (!isInEnum(obj.overallRisk, VALID_OVERALL_RISK))       errors.push('overallRisk invalid');
  if (!isNonEmptyString(obj.reasoning))                     errors.push('reasoning required');
  return { valid: errors.length === 0, errors };
}

function sanitizeChangeIntelligenceOutput(obj) {
  const o = (obj && typeof obj === 'object') ? obj : {};
  const changes = Array.isArray(o.changes) ? o.changes.map((c, i) => {
    const cc = (c && typeof c === 'object') ? c : {};
    const safe = {
      id:                isNonEmptyString(cc.id) ? cc.id : `change-${i}`,
      intent:            isNonEmptyString(cc.intent) ? cc.intent : 'Unspecified change',
      surface:           isInEnum(cc.surface, VALID_SURFACES) ? cc.surface : 'config',
      breakingChange:    typeof cc.breakingChange === 'boolean' ? cc.breakingChange : false,
      affectedUserFlows: isStringArray(cc.affectedUserFlows) ? cc.affectedUserFlows : [],
      affectedComponents:isStringArray(cc.affectedComponents) ? cc.affectedComponents : [],
      affectedPOMs:      isStringArray(cc.affectedPOMs) ? cc.affectedPOMs : [],
      riskFactors:       isStringArray(cc.riskFactors) ? cc.riskFactors : [],
      suggestedCoverage: isStringArray(cc.suggestedCoverage) ? cc.suggestedCoverage : [],
      suggestedTestTypes:isStringArray(cc.suggestedTestTypes) ? cc.suggestedTestTypes : [],
      confidence:        isUnitInterval(cc.confidence) ? cc.confidence : 0
    };
    if (cc.domainImpact && typeof cc.domainImpact === 'object') {
      safe.domainImpact = {
        regulations:      isStringArray(cc.domainImpact.regulations) ? cc.domainImpact.regulations : [],
        requiredControls: isStringArray(cc.domainImpact.requiredControls) ? cc.domainImpact.requiredControls : []
      };
    }
    return safe;
  }) : [];
  return {
    changes,
    overallRisk: isInEnum(o.overallRisk, VALID_OVERALL_RISK) ? o.overallRisk : 'low',
    reasoning:   isNonEmptyString(o.reasoning) ? o.reasoning : 'No reasoning provided.'
  };
}

// ─── Agent 2: testDiscovery ────────────────────────────────────────────────
function validateTestDiscoveryOutput(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['testDiscovery output not an object'] };
  if (!Array.isArray(obj.changeMatches))            errors.push('changeMatches must be an array');
  else obj.changeMatches.forEach((m, i) => {
    if (!m || typeof m !== 'object')                       { errors.push(`changeMatches[${i}] not an object`); return; }
    if (!isNonEmptyString(m.changeId))                      errors.push(`changeMatches[${i}].changeId required`);
    if (!Array.isArray(m.coverage))                         errors.push(`changeMatches[${i}].coverage must be array`);
    else m.coverage.forEach((c, j) => {
      if (!c || typeof c !== 'object')                              { errors.push(`coverage[${i}][${j}] not an object`); return; }
      if (!isNonEmptyString(c.zephyrTestCaseKey))                     errors.push(`coverage[${i}][${j}].zephyrTestCaseKey required`);
      if (!isNonEmptyString(c.specPath))                             errors.push(`coverage[${i}][${j}].specPath required`);
      if (!isInEnum(c.coverageType, VALID_COVERAGE_TYPES))           errors.push(`coverage[${i}][${j}].coverageType invalid`);
      if (!isUnitInterval(c.confidence))                             errors.push(`coverage[${i}][${j}].confidence must be 0..1`);
      if (!isNonEmptyString(c.reasoning))                            errors.push(`coverage[${i}][${j}].reasoning required`);
      if (!isInEnum(c.decision, VALID_DISCOVERY_DECISIONS))          errors.push(`coverage[${i}][${j}].decision invalid`);
    });
    if (!isStringArray(m.gapsRequiringNewTests))            errors.push(`changeMatches[${i}].gapsRequiringNewTests must be string[]`);
    if (!isUnitInterval(m.confidence))                      errors.push(`changeMatches[${i}].confidence must be 0..1`);
  });
  if (!isStringArray(obj.unmatched))                        errors.push('unmatched must be string[]');
  return { valid: errors.length === 0, errors };
}

function sanitizeTestDiscoveryOutput(obj) {
  const o = (obj && typeof obj === 'object') ? obj : {};
  const changeMatches = Array.isArray(o.changeMatches) ? o.changeMatches.map((m, i) => {
    const mm = (m && typeof m === 'object') ? m : {};
    const coverage = Array.isArray(mm.coverage) ? mm.coverage.map((c, j) => {
      const cc = (c && typeof c === 'object') ? c : {};
      return {
        zephyrTestCaseKey: isNonEmptyString(cc.zephyrTestCaseKey) ? cc.zephyrTestCaseKey : `UNKNOWN-T${i}${j}`,
        specPath:     isNonEmptyString(cc.specPath) ? cc.specPath : '',
        coverageType: isInEnum(cc.coverageType, VALID_COVERAGE_TYPES) ? cc.coverageType : 'tangential',
        confidence:   isUnitInterval(cc.confidence) ? cc.confidence : 0,
        reasoning:    isNonEmptyString(cc.reasoning) ? cc.reasoning : 'Auto-defaulted',
        decision:     isInEnum(cc.decision, VALID_DISCOVERY_DECISIONS) ? cc.decision : 'leave_alone'
      };
    }) : [];
    return {
      changeId:               isNonEmptyString(mm.changeId) ? mm.changeId : `change-${i}`,
      coverage,
      gapsRequiringNewTests:  isStringArray(mm.gapsRequiringNewTests) ? mm.gapsRequiringNewTests : [],
      confidence:             isUnitInterval(mm.confidence) ? mm.confidence : 0
    };
  }) : [];
  return {
    changeMatches,
    unmatched: isStringArray(o.unmatched) ? o.unmatched : []
  };
}

// ─── Agent 3: testAuthoring ────────────────────────────────────────────────
function validateTestAuthoringOutput(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['testAuthoring output not an object'] };
  if (!Array.isArray(obj.artifacts)) errors.push('artifacts must be an array');
  else obj.artifacts.forEach((a, i) => {
    if (!a || typeof a !== 'object')                              { errors.push(`artifacts[${i}] not an object`); return; }
    if (!isInEnum(a.type, VALID_AUTHORING_TYPES))                  errors.push(`artifacts[${i}].type invalid`);
    if (!isNonEmptyString(a.target))                               errors.push(`artifacts[${i}].target required`);
    if (typeof a.content !== 'string')                             errors.push(`artifacts[${i}].content must be string`);
    if (!a.almPayload || typeof a.almPayload !== 'object')         errors.push(`artifacts[${i}].almPayload must be object`);
    if (!isUnitInterval(a.confidence))                             errors.push(`artifacts[${i}].confidence must be 0..1`);
    if (typeof a.requiresHumanReview !== 'boolean')                errors.push(`artifacts[${i}].requiresHumanReview must be boolean`);
    if (!isNonEmptyString(a.rationale))                            errors.push(`artifacts[${i}].rationale required`);
    if (!a.selfChecks || typeof a.selfChecks !== 'object')         errors.push(`artifacts[${i}].selfChecks must be object`);
    else {
      ['followsPOM', 'usesGWT', 'importsBaseFixture', 'hasTags'].forEach(k => {
        if (typeof a.selfChecks[k] !== 'boolean')                  errors.push(`artifacts[${i}].selfChecks.${k} must be boolean`);
      });
    }
  });
  return { valid: errors.length === 0, errors };
}

function sanitizeTestAuthoringOutput(obj) {
  const o = (obj && typeof obj === 'object') ? obj : {};
  const artifacts = Array.isArray(o.artifacts) ? o.artifacts.map((a, i) => {
    const aa = (a && typeof a === 'object') ? a : {};
    const sc = (aa.selfChecks && typeof aa.selfChecks === 'object') ? aa.selfChecks : {};
    return {
      type:                isInEnum(aa.type, VALID_AUTHORING_TYPES) ? aa.type : 'new_spec',
      target:              isNonEmptyString(aa.target) ? aa.target : `tests/specs/auto-${i}.spec.js`,
      content:             typeof aa.content === 'string' ? aa.content : '',
      almPayload:          (aa.almPayload && typeof aa.almPayload === 'object') ? aa.almPayload : {},
      confidence:          isUnitInterval(aa.confidence) ? aa.confidence : 0,
      requiresHumanReview: typeof aa.requiresHumanReview === 'boolean' ? aa.requiresHumanReview : true,
      rationale:           isNonEmptyString(aa.rationale) ? aa.rationale : 'Auto-defaulted',
      selfChecks: {
        followsPOM:         typeof sc.followsPOM === 'boolean' ? sc.followsPOM : false,
        usesGWT:            typeof sc.usesGWT === 'boolean' ? sc.usesGWT : false,
        importsBaseFixture: typeof sc.importsBaseFixture === 'boolean' ? sc.importsBaseFixture : false,
        hasTags:            typeof sc.hasTags === 'boolean' ? sc.hasTags : false
      }
    };
  }) : [];
  return { artifacts };
}

// ─── Agent 4: testCycleCurator ─────────────────────────────────────────────
function validateTestCycleCuratorOutput(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['testCycleCurator output not an object'] };
  const c = obj.cycle;
  if (!c || typeof c !== 'object') errors.push('cycle must be object');
  else {
    if (!isNonEmptyString(c.name))         errors.push('cycle.name required');
    if (!isNonEmptyString(c.description))  errors.push('cycle.description required');
    if (!Array.isArray(c.executionGroups)) errors.push('cycle.executionGroups must be array');
    else c.executionGroups.forEach((g, i) => {
      if (!g || typeof g !== 'object')                  { errors.push(`executionGroups[${i}] not an object`); return; }
      if (!isNonEmptyString(g.name))                     errors.push(`executionGroups[${i}].name required`);
      if (typeof g.parallel !== 'boolean')               errors.push(`executionGroups[${i}].parallel must be boolean`);
      if (typeof g.gateOnPrevious !== 'boolean')         errors.push(`executionGroups[${i}].gateOnPrevious must be boolean`);
      if (!isStringArray(g.testCaseKeys))                errors.push(`executionGroups[${i}].testCaseKeys must be string[]`);
      if (!isNonEmptyString(g.rationale))                errors.push(`executionGroups[${i}].rationale required`);
    });
    if (typeof c.estimatedDurationMins !== 'number' || c.estimatedDurationMins < 0) {
      errors.push('cycle.estimatedDurationMins must be non-negative number');
    }
    if (!isStringArray(c.complianceMandated)) errors.push('cycle.complianceMandated must be string[]');
  }
  if (!isNonEmptyString(obj.reasoning)) errors.push('reasoning required');
  return { valid: errors.length === 0, errors };
}

function sanitizeTestCycleCuratorOutput(obj) {
  const o = (obj && typeof obj === 'object') ? obj : {};
  const c = (o.cycle && typeof o.cycle === 'object') ? o.cycle : {};
  const groups = Array.isArray(c.executionGroups) ? c.executionGroups.map((g, i) => {
    const gg = (g && typeof g === 'object') ? g : {};
    return {
      name:           isNonEmptyString(gg.name) ? gg.name : `group-${i}`,
      parallel:       typeof gg.parallel === 'boolean' ? gg.parallel : false,
      gateOnPrevious: typeof gg.gateOnPrevious === 'boolean' ? gg.gateOnPrevious : false,
      testCaseKeys:   isStringArray(gg.testCaseKeys) ? gg.testCaseKeys : [],
      rationale:      isNonEmptyString(gg.rationale) ? gg.rationale : 'Auto-defaulted'
    };
  }) : [];
  return {
    cycle: {
      name:                  isNonEmptyString(c.name) ? c.name : 'DevChange-unknown',
      description:           isNonEmptyString(c.description) ? c.description : 'Auto-curated dev-change cycle',
      executionGroups:       groups,
      estimatedDurationMins: (typeof c.estimatedDurationMins === 'number' && c.estimatedDurationMins >= 0)
                               ? c.estimatedDurationMins : 0,
      complianceMandated:    isStringArray(c.complianceMandated) ? c.complianceMandated : []
    },
    reasoning: isNonEmptyString(o.reasoning) ? o.reasoning : 'No reasoning provided.'
  };
}

// ─── Agent 5: executionReflection ──────────────────────────────────────────
function validateExecutionReflectionOutput(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['executionReflection output not an object'] };
  if (!Array.isArray(obj.classifications)) errors.push('classifications must be an array');
  else obj.classifications.forEach((c, i) => {
    if (!c || typeof c !== 'object')                          { errors.push(`classifications[${i}] not an object`); return; }
    if (!isNonEmptyString(c.testCaseKey))                      errors.push(`classifications[${i}].testCaseKey required`);
    if (!isInEnum(c.actualVerdict, VALID_REFLECTION_VERDICTS)) errors.push(`classifications[${i}].actualVerdict invalid`);
    if (!isUnitInterval(c.confidence))                         errors.push(`classifications[${i}].confidence must be 0..1`);
    if (!isNonEmptyString(c.reasoning))                        errors.push(`classifications[${i}].reasoning required`);
    if (!isInEnum(c.recommendedAction, VALID_REFLECTION_ACTIONS)) errors.push(`classifications[${i}].recommendedAction invalid`);
    if (c.causalReasoning !== undefined && c.causalReasoning !== null) {
      if (typeof c.causalReasoning !== 'object') errors.push(`classifications[${i}].causalReasoning must be object`);
      else {
        if (!isInEnum(c.causalReasoning.pattern, VALID_CROSSRUN_PATTERNS)) errors.push(`classifications[${i}].causalReasoning.pattern invalid`);
        if (!isNonEmptyString(c.causalReasoning.likelyCause))              errors.push(`classifications[${i}].causalReasoning.likelyCause required`);
        if (!isStringArray(c.causalReasoning.correlatedTests))             errors.push(`classifications[${i}].causalReasoning.correlatedTests must be string[]`);
        if (!isStringArray(c.causalReasoning.correlatedCommits))           errors.push(`classifications[${i}].causalReasoning.correlatedCommits must be string[]`);
        if (!isNonEmptyString(c.causalReasoning.recommendedInvestigation)) errors.push(`classifications[${i}].causalReasoning.recommendedInvestigation required`);
      }
    }
  });
  if (!isNonEmptyString(obj.summary)) errors.push('summary required');
  return { valid: errors.length === 0, errors };
}

function sanitizeExecutionReflectionOutput(obj) {
  const o = (obj && typeof obj === 'object') ? obj : {};
  const classifications = Array.isArray(o.classifications) ? o.classifications.map((c, i) => {
    const cc = (c && typeof c === 'object') ? c : {};
    const out = {
      testCaseKey:       isNonEmptyString(cc.testCaseKey) ? cc.testCaseKey : `UNKNOWN-T${i}`,
      actualVerdict:     isInEnum(cc.actualVerdict, VALID_REFLECTION_VERDICTS) ? cc.actualVerdict : 'flag_for_review_default',
      confidence:        isUnitInterval(cc.confidence) ? cc.confidence : 0,
      reasoning:         isNonEmptyString(cc.reasoning) ? cc.reasoning : 'Auto-defaulted',
      recommendedAction: isInEnum(cc.recommendedAction, VALID_REFLECTION_ACTIONS) ? cc.recommendedAction : 'flag_for_review'
    };
    // Coerce invalid actualVerdict to a valid sentinel
    if (!VALID_REFLECTION_VERDICTS.includes(out.actualVerdict)) out.actualVerdict = 'environmental';
    if (isNonEmptyString(cc.feedbackForAuthoring)) out.feedbackForAuthoring = cc.feedbackForAuthoring;
    if (cc.causalReasoning && typeof cc.causalReasoning === 'object') {
      const cr = cc.causalReasoning;
      out.causalReasoning = {
        pattern:                  isInEnum(cr.pattern, VALID_CROSSRUN_PATTERNS) ? cr.pattern : 'first_failure',
        likelyCause:              isNonEmptyString(cr.likelyCause) ? cr.likelyCause : 'unknown',
        correlatedTests:          isStringArray(cr.correlatedTests) ? cr.correlatedTests : [],
        correlatedCommits:        isStringArray(cr.correlatedCommits) ? cr.correlatedCommits : [],
        recommendedInvestigation: isNonEmptyString(cr.recommendedInvestigation) ? cr.recommendedInvestigation : 'Manual review.'
      };
    }
    return out;
  }) : [];
  return {
    classifications,
    summary: isNonEmptyString(o.summary) ? o.summary : 'No summary provided.'
  };
}

// ─── Agent 6: adversarial ──────────────────────────────────────────────────
function validateAdversarialOutput(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['adversarial output not an object'] };
  if (!Array.isArray(obj.attacks)) errors.push('attacks must be an array');
  else obj.attacks.forEach((a, i) => {
    if (!a || typeof a !== 'object')                       { errors.push(`attacks[${i}] not an object`); return; }
    if (!isNonEmptyString(a.name))                          errors.push(`attacks[${i}].name required`);
    if (!isNonEmptyString(a.rationale))                     errors.push(`attacks[${i}].rationale required`);
    if (!isNonEmptyString(a.targetChange))                  errors.push(`attacks[${i}].targetChange required`);
    if (!isInEnum(a.attackVector, VALID_ATTACK_VECTORS))    errors.push(`attacks[${i}].attackVector invalid`);
    if (!isNonEmptyString(a.proposedTestSpec))              errors.push(`attacks[${i}].proposedTestSpec required`);
    if (!isInEnum(a.severity, VALID_ATTACK_SEVERITY))       errors.push(`attacks[${i}].severity invalid`);
    if (!isUnitInterval(a.novelty))                         errors.push(`attacks[${i}].novelty must be 0..1`);
  });
  if (!isNonEmptyString(obj.reasoning)) errors.push('reasoning required');
  return { valid: errors.length === 0, errors };
}

function sanitizeAdversarialOutput(obj) {
  const o = (obj && typeof obj === 'object') ? obj : {};
  const attacks = Array.isArray(o.attacks) ? o.attacks.map((a, i) => {
    const aa = (a && typeof a === 'object') ? a : {};
    return {
      name:             isNonEmptyString(aa.name) ? aa.name : `attack-${i}`,
      rationale:        isNonEmptyString(aa.rationale) ? aa.rationale : 'Auto-defaulted',
      targetChange:     isNonEmptyString(aa.targetChange) ? aa.targetChange : `change-${i}`,
      attackVector:     isInEnum(aa.attackVector, VALID_ATTACK_VECTORS) ? aa.attackVector : 'data_boundary',
      proposedTestSpec: isNonEmptyString(aa.proposedTestSpec) ? aa.proposedTestSpec : '// auto-defaulted empty test',
      severity:         isInEnum(aa.severity, VALID_ATTACK_SEVERITY) ? aa.severity : 'low',
      novelty:          isUnitInterval(aa.novelty) ? aa.novelty : 0
    };
  }) : [];
  return {
    attacks,
    reasoning: isNonEmptyString(o.reasoning) ? o.reasoning : 'No reasoning provided.'
  };
}

// ─── Agent 7: critic ───────────────────────────────────────────────────────
function validateCriticOutput(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['critic output not an object'] };
  if (typeof obj.approved !== 'boolean') errors.push('approved must be boolean');
  if (!Array.isArray(obj.issues)) errors.push('issues must be an array');
  else obj.issues.forEach((it, i) => {
    if (!it || typeof it !== 'object')                  { errors.push(`issues[${i}] not an object`); return; }
    if (!isInEnum(it.severity, VALID_CRITIC_SEVERITY))   errors.push(`issues[${i}].severity invalid`);
    if (!isNonEmptyString(it.location))                  errors.push(`issues[${i}].location required`);
    if (!isNonEmptyString(it.description))               errors.push(`issues[${i}].description required`);
    if (!isNonEmptyString(it.suggestedFix))              errors.push(`issues[${i}].suggestedFix required`);
  });
  if (!isNonEmptyString(obj.overallAssessment)) errors.push('overallAssessment required');
  return { valid: errors.length === 0, errors };
}

function sanitizeCriticOutput(obj) {
  const o = (obj && typeof obj === 'object') ? obj : {};
  const issues = Array.isArray(o.issues) ? o.issues.map((it, i) => {
    const ii = (it && typeof it === 'object') ? it : {};
    return {
      severity:     isInEnum(ii.severity, VALID_CRITIC_SEVERITY) ? ii.severity : 'nitpick',
      location:     isNonEmptyString(ii.location) ? ii.location : `unknown-${i}`,
      description:  isNonEmptyString(ii.description) ? ii.description : 'Auto-defaulted',
      suggestedFix: isNonEmptyString(ii.suggestedFix) ? ii.suggestedFix : 'No suggestion.'
    };
  }) : [];
  return {
    approved:          typeof o.approved === 'boolean' ? o.approved : false,
    issues,
    overallAssessment: isNonEmptyString(o.overallAssessment) ? o.overallAssessment : 'No assessment provided.'
  };
}

module.exports = {
  validatePlannerOutput,          sanitizePlannerOutput,
  validateQATestCase,             sanitizeQATestCase,
  validateQAOutput,               sanitizeQAOutput,
  validateReviewerOutput,         sanitizeReviewerOutput,
  validateRiskPrioritizerOutput,  sanitizeRiskPrioritizerOutput,
  validateExecutorOutput,         sanitizeExecutorOutput,
  VALID_PRIORITIES,
  // ─── Dev-Change Reconciliation (Section 23) ─────────────────────────
  validateChangeIntelligenceOutput, sanitizeChangeIntelligenceOutput,
  validateTestDiscoveryOutput,      sanitizeTestDiscoveryOutput,
  validateTestAuthoringOutput,      sanitizeTestAuthoringOutput,
  validateTestCycleCuratorOutput,   sanitizeTestCycleCuratorOutput,
  validateExecutionReflectionOutput,sanitizeExecutionReflectionOutput,
  validateAdversarialOutput,        sanitizeAdversarialOutput,
  validateCriticOutput,             sanitizeCriticOutput,
  VALID_SURFACES,
  VALID_OVERALL_RISK,
  VALID_COVERAGE_TYPES,
  VALID_DISCOVERY_DECISIONS,
  VALID_AUTHORING_TYPES,       // ['new_spec','patch_spec','new_zephyr_testcase','update_zephyr_testcase']
  VALID_REFLECTION_VERDICTS,
  VALID_REFLECTION_ACTIONS,   // ['create_jira_bug','mark_flaky','flag_for_review','no_action']
  VALID_CROSSRUN_PATTERNS,
  VALID_ATTACK_VECTORS,
  VALID_ATTACK_SEVERITY,
  VALID_CRITIC_SEVERITY
};
