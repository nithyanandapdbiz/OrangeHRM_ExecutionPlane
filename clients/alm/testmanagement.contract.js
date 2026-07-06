'use strict';
/**
 * TestManagement contract — the interface the Execution Plane depends on for
 * test-case authoring, test cycles and execution results. Business logic depends
 * on THIS shape, never on a concrete provider (Zephyr Essential). This is the
 * provider-isolation seam for test management.
 *
 * Implemented by: clients/zephyr.client.js (ZephyrClient).
 *
 * @typedef {Object} TestCaseRef  { id:string, key:string, title:string }
 * @typedef {Object} CycleRef     { id:string, key:string, name:string }
 * @typedef {Object} ExecResult   { title:string, passed:boolean, error?:string,
 *                                   durationMs?:number, testCaseKey?:string }
 *
 * Interface:
 *   checkConnectivity()                          → { connected:boolean, status:number }
 *   createTestCase(parentKey, tc)                → Promise<TestCaseRef>
 *   batchCreateTestCases(parentKey, tcs[])       → Promise<TestCaseRef[]>
 *   createTestCycle(name, testCaseKeys[])        → Promise<CycleRef>
 *   updateTestResults(cycleKey, ExecResult[])    → Promise<{ok, synced, passed, failed}>
 *   completeTestCycle(cycleKey)                  → Promise<void>
 */
const REQUIRED_METHODS = [
  'createTestCase',
  'batchCreateTestCases',
  'createTestCycle',
  'updateTestResults',
  'completeTestCycle',
];

/** Assert an object satisfies the TestManagement contract. Throws if not. */
function assertTestManagement(impl, name = 'TestManagement') {
  for (const m of REQUIRED_METHODS) {
    if (typeof impl?.[m] !== 'function') {
      throw new Error(`${name} does not implement required TestManagement method: ${m}()`);
    }
  }
  return impl;
}

module.exports = { REQUIRED_METHODS, assertTestManagement };
