'use strict';
/**
 * appModel.js — runtime model of the OrangeHRM React web application.
 *
 * OrangeHRM is a React single-page app. This module is the structural backbone
 * consumed by the page objects, side-menu component, and the executability /
 * locator engines: it maps each product module to its route, main-menu entry,
 * and canonical `.oxd-*` selectors.
 *
 * Source of Truth:
 *   Derived from the OrangeHRM app under test (APP_BASE_URL) and its stable
 *   `.oxd-*` design-system class names. Never derived from AI inference alone.
 *
 * Public API:
 *   getModel()                          → full app model
 *   getModule(name)                     → ModuleModel | null
 *   getEntity(name)                     → alias of getModule (back-compat)
 *   getRoute(name)                      → route path | null
 *   getNavUrl(name, baseUrl?)           → absolute URL to a module
 *   getNewRecordUrl(name, baseUrl?)     → absolute URL to a module's "add" form
 *   MODULES                             → { [name]: ModuleModel }
 *   MODULE_NAMES                        → string[]
 *   SELECTORS                           → canonical OrangeHRM selectors
 *   SAMPLE_FEATURE                      → canonical example feature
 */

// ─── Canonical OrangeHRM selectors (stable .oxd-* design system) ───────────────

const SELECTORS = {
  // Login form
  username:      'input[name="username"]',
  password:      'input[name="password"]',
  submit:        'button[type="submit"]',
  loginError:    '.oxd-alert-content-text',
  // Generic controls
  input:         '.oxd-input',
  button:        '.oxd-button',
  select:        '.oxd-select-text',
  checkbox:      '.oxd-checkbox-input',
  // Navigation & chrome
  mainMenuItem:  '.oxd-main-menu-item',
  topbarHeader:  '.oxd-topbar-header',
  breadcrumb:    '.oxd-topbar-header-breadcrumb',
  userDropdown:  '.oxd-userdropdown-tab',
  // Data & feedback
  tableRow:      '.oxd-table-card',
  tableHeader:   '.oxd-table-header',
  toast:         '.oxd-toast',
  dialog:        '.oxd-dialog-container',
  spinner:       '.oxd-loading-spinner',
};

const LOGIN_PATH = '/web/index.php/auth/login';

// ─── Module definitions (Dashboard / Admin / PIM / Leave / …) ──────────────────
// Each module carries: React route, main-menu label, and key form selectors.

const MODULES = {
  dashboard: {
    name: 'Dashboard', menuLabel: 'Dashboard',
    route: '/web/index.php/dashboard/index',
    widgets: '.oxd-grid-item',
  },
  admin: {
    name: 'Admin', menuLabel: 'Admin',
    route: '/web/index.php/admin/viewSystemUsers',
    addRoute: '/web/index.php/admin/saveSystemUser',
    fields: {
      userRole:     { label: 'User Role',    required: true,  selector: '.oxd-select-text' },
      employeeName: { label: 'Employee Name', required: true,  selector: 'input[placeholder="Type for hints..."]' },
      status:       { label: 'Status',       required: true,  selector: '.oxd-select-text' },
      username:     { label: 'Username',     required: true,  selector: '.oxd-input' },
      password:     { label: 'Password',     required: true,  selector: 'input[type="password"]' },
    },
  },
  pim: {
    name: 'PIM', menuLabel: 'PIM',
    route: '/web/index.php/pim/viewEmployeeList',
    addRoute: '/web/index.php/pim/addEmployee',
    fields: {
      firstName:   { label: 'First Name',   required: true,  selector: 'input[name="firstName"]' },
      middleName:  { label: 'Middle Name',  required: false, selector: 'input[name="middleName"]' },
      lastName:    { label: 'Last Name',    required: true,  selector: 'input[name="lastName"]' },
      employeeId:  { label: 'Employee Id',  required: false, selector: '.oxd-input' },
    },
    saveButton: '.oxd-button--secondary[type="submit"]',
    searchInput: '.oxd-input',
  },
  leave: {
    name: 'Leave', menuLabel: 'Leave',
    route: '/web/index.php/leave/viewLeaveList',
    applyRoute: '/web/index.php/leave/applyLeave',
  },
  time: {
    name: 'Time', menuLabel: 'Time',
    route: '/web/index.php/time/viewEmployeeTimesheet',
  },
  recruitment: {
    name: 'Recruitment', menuLabel: 'Recruitment',
    route: '/web/index.php/recruitment/viewCandidates',
  },
  myinfo: {
    name: 'My Info', menuLabel: 'My Info',
    route: '/web/index.php/pim/viewMyDetails',
  },
  performance: {
    name: 'Performance', menuLabel: 'Performance',
    route: '/web/index.php/performance/searchEvaluatePerformanceReview',
  },
  directory: {
    name: 'Directory', menuLabel: 'Directory',
    route: '/web/index.php/directory/viewDirectory',
  },
  maintenance: {
    name: 'Maintenance', menuLabel: 'Maintenance',
    route: '/web/index.php/maintenance/purgeEmployee',
  },
  buzz: {
    name: 'Buzz', menuLabel: 'Buzz',
    route: '/web/index.php/buzz/viewBuzz',
  },
  claim: {
    name: 'Claim', menuLabel: 'Claim',
    route: '/web/index.php/claim/viewAssignClaim',
  },
};

// ─── Canonical example feature (replaces the old lead→opportunity→won flow) ────

const SAMPLE_FEATURE = {
  name: 'Employee Login & PIM Add-Employee',
  steps: [
    { module: 'dashboard', action: 'Login',       selector: SELECTORS.submit },
    { module: 'pim',       action: 'AddEmployee', selector: 'input[name="firstName"]' },
  ],
  otherSamples: ['add-user (Admin)', 'apply-leave (Leave)', 'search-employee (PIM)'],
};

// ─── Convenience constants ─────────────────────────────────────────────────────

const MODULE_NAMES = Object.keys(MODULES);

// ─── Public API ───────────────────────────────────────────────────────────────

function getModel() {
  return {
    app:       'OrangeHRM',
    framework: 'React SPA',
    loginPath: LOGIN_PATH,
    modules:   Object.values(MODULES),
    selectors: SELECTORS,
    feature:   SAMPLE_FEATURE,
  };
}

function getModule(name) {
  if (!name) return null;
  const key = String(name).toLowerCase().replace(/[\s_-]+/g, '');
  return MODULES[key] || Object.values(MODULES).find(m => m.name.toLowerCase() === String(name).toLowerCase()) || null;
}

// Back-compat alias for callers that used getEntity().
function getEntity(name) {
  return getModule(name);
}

function getRoute(name) {
  const m = getModule(name);
  return m ? m.route : null;
}

function baseFrom(baseUrl) {
  return (baseUrl || process.env.APP_BASE_URL || process.env.TEST_BASE_URL || '').replace(/\/$/, '');
}

function getNavUrl(name, baseUrl) {
  const m = getModule(name);
  const base = baseFrom(baseUrl);
  if (!m) return base;
  return `${base}${m.route}`;
}

function getNewRecordUrl(name, baseUrl) {
  const m = getModule(name);
  const base = baseFrom(baseUrl);
  if (!m) return base;
  return `${base}${m.addRoute || m.applyRoute || m.route}`;
}

module.exports = {
  getModel,
  getModule,
  getEntity,
  getRoute,
  getNavUrl,
  getNewRecordUrl,
  MODULES,
  MODULE_NAMES,
  SELECTORS,
  LOGIN_PATH,
  SAMPLE_FEATURE,
};
