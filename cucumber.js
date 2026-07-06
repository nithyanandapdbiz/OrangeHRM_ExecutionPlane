// Cucumber runner configuration
// Run: npx cucumber-js
// Or filtered by tag: npx cucumber-js --tags "@smoke"
// Or a specific feature: npx cucumber-js tests/features/employee-login/
module.exports = {
  default: {
    // Feature files (OrangeHRM modules)
    paths: ['tests/features/**/*.feature'],

    // Step definitions + support files (World and global hooks)
    require: [
      'tests/support/world.js',
      'tests/support/hooks.js',
      'tests/step-definitions/**/*.steps.js',
    ],

    // Output format
    // html: self-contained functional report (built-in @cucumber/html-formatter)
    format: [
      'progress-bar',
      'json:reports/cucumber-report.json',
      'junit:reports/cucumber-report.xml',
      'html:reports/cucumber-report.html',
    ],

    // Suppress Cucumber's "publish results" prompt in CI
    publishQuiet: true,

    // Global step and hook timeout (ms).
    // Must be >= the OrangeHRM login + SPA hydration time to prevent Before
    // hook timeouts during session refresh. Override via env for CI/local.
    timeout: parseInt(process.env.CUCUMBER_STEP_TIMEOUT_MS || '120000', 10),

    // Parallel workers — set CUCUMBER_WORKERS env var to increase for CI.
    // Shared-session mode automatically falls back to scenario mode when >1.
    parallel: parseInt(process.env.CUCUMBER_WORKERS || '1', 10),

    // Exit with non-zero code when there are undefined/pending steps
    strict: false,
  },
};
