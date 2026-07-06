'use strict';
/**
 * testData.js — OrangeHRM sample data for Playwright + Cucumber automation.
 *
 * Credentials and base URL are env-driven (APP_BASE_URL / APP_USERNAME /
 * APP_PASSWORD) with safe public-demo defaults. Employee/user fixtures below
 * are sample records; `uniqueSuffix()` keeps generated usernames/ids collision
 * free across runs.
 */

const BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.TEST_BASE_URL ||
  'https://opensource-demo.orangehrmlive.com';

const CREDENTIALS = {
  admin: {
    username: process.env.APP_USERNAME || 'Admin',
    password: process.env.APP_PASSWORD || 'admin123',
  },
};

/** Short timestamp suffix for test-data isolation. */
function uniqueSuffix() {
  return String(Date.now()).slice(-6);
}

// ── OrangeHRM module routes (relative to BASE_URL) ──────────────────────────
const ROUTES = {
  login:           '/web/index.php/auth/login',
  dashboard:       '/web/index.php/dashboard/index',
  pimAddEmployee:  '/web/index.php/pim/addEmployee',
  pimEmployeeList: '/web/index.php/pim/viewEmployeeList',
  adminAddUser:    '/web/index.php/admin/saveSystemUser',
  adminUserList:   '/web/index.php/admin/viewSystemUsers',
  leaveApply:      '/web/index.php/leave/applyLeave',
  leaveList:       '/web/index.php/leave/viewLeaveList',
};

// ── Sample employees (PIM > Add Employee) ───────────────────────────────────
const EMPLOYEES = {
  standard: { firstName: 'Alex', middleName: '', lastName: 'Turner' },
  withMiddle: { firstName: 'Priya', middleName: 'S', lastName: 'Nair' },
  contractor: { firstName: 'Sam', middleName: '', lastName: 'Doe' },
};

// ── Sample system users (Admin > Add User) ──────────────────────────────────
const USERS = {
  ess: {
    role: 'ESS',
    status: 'Enabled',
    employeeName: 'Admin',
    username: `ess.user.${uniqueSuffix()}`,
    password: 'Passw0rd!123',
  },
  admin: {
    role: 'Admin',
    status: 'Enabled',
    employeeName: 'Admin',
    username: `admin.user.${uniqueSuffix()}`,
    password: 'Passw0rd!123',
  },
};

// ── Sample leave request (Leave > Apply) ────────────────────────────────────
const LEAVE = {
  casual: {
    leaveType: 'CAN - Personal',
    fromDate: '2030-01-06',
    toDate: '2030-01-06',
    comment: 'Automated leave request',
  },
};

module.exports = {
  BASE_URL,
  CREDENTIALS,
  ROUTES,
  EMPLOYEES,
  USERS,
  LEAVE,
  uniqueSuffix,
};
