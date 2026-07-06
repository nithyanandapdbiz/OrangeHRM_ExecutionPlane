# Tests

Playwright + Cucumber (BDD) automation for the **OrangeHRM** React web app, using
the Page Object Model (POM) with a ScreenshotHelper.

## Structure

```
tests/
├── global-setup.js            # Dir init + OrangeHRM auth + session cache + cleanup
├── global-teardown.js         # Suite summary + Allure results validation
├── data/
│   └── testData.js            # OrangeHRM sample data + credentials (env-var driven)
├── fixtures/
│   ├── base.fixture.js        # Master fixture: ScreenshotHelper + lifecycle hooks
│   └── pom.fixture.js         # POM fixture: injects Login/Dashboard/Pim/Admin/Leave pages
├── helpers/
│   ├── screenshot.helper.js   # Step-based screenshot capture with Allure integration
│   └── locatorLoader.js       # Locator file parser for page objects
├── auth/
│   └── authManager.js         # OrangeHRM login-session (storage-state) manager
├── runtime/
│   └── sharedSessionManager.js# One browser/context/page shared across a run
├── support/
│   ├── world.js               # Cucumber World (this.page / context / browser)
│   └── hooks.js               # BeforeAll/Before/After/AfterAll lifecycle
├── features/
│   ├── employee-login/employee-login.feature
│   ├── pim-add-employee/pim-add-employee.feature
│   └── admin-add-user/admin-add-user.feature
├── step-definitions/
│   ├── shared.steps.js        # Sign-in + module navigation
│   ├── login.steps.js         # Employee Login
│   ├── pim.steps.js           # PIM Add Employee
│   └── admin.steps.js         # Admin Add User
├── pages/
│   ├── LoginPage.js           # /web/index.php/auth/login
│   ├── DashboardPage.js       # /web/index.php/dashboard/index
│   ├── PimPage.js             # PIM Add Employee / Employee List
│   ├── AdminPage.js           # Admin Add User / User Management
│   └── LeavePage.js           # Leave Apply / Leave List
├── locators/
│   ├── Login.locators.js
│   ├── Pim.locators.js
│   └── Admin.locators.js
└── components/
    ├── SideMenuComponent.js   # .oxd-main-menu-item navigation
    ├── DataTableComponent.js  # .oxd-table-card grid
    └── ToastComponent.js      # .oxd-toast notifications
```

## Key Patterns

- **OrangeHRM selectors**: auth fields use `input[name="username"]`,
  `input[name="password"]`, `button[type="submit"]`; the app shell uses oxd
  component classes (`.oxd-input`, `.oxd-button`, `.oxd-main-menu-item`,
  `.oxd-table-card`, `.oxd-toast`).
- **React SPA awareness**: navigation is client-side routing; save flows are
  confirmed via oxd success toasts and route changes rather than full reloads.
- **Composed Fixtures**: `base.fixture.js` provides `sh` (ScreenshotHelper),
  `page`, and `uniqueSuffix`; `pom.fixture.js` injects page objects.
- **Session reuse**: `authManager.js` signs in once (APP_USERNAME / APP_PASSWORD)
  and reuses the captured storage state across scenarios.
- **Hook Lifecycle**: BeforeAll (auth + shared browser), Before (session guard),
  After (screenshot + failure diagnostics + video), AfterAll (teardown).

## Environment

| Var | Default | Purpose |
|---|---|---|
| `APP_BASE_URL`  | `https://opensource-demo.orangehrmlive.com` | App under test |
| `APP_USERNAME`  | `Admin`    | Login user |
| `APP_PASSWORD`  | `admin123` | Login password |

## Running Tests

```bash
npx cucumber-js                              # Run all features
npx cucumber-js --tags "@smoke"              # Smoke only
npx cucumber-js tests/features/employee-login/   # A single feature
CUCUMBER_WORKERS=2 npx cucumber-js           # Parallel (falls back to scenario mode)
PW_HEADLESS=true npx cucumber-js             # Headless (CI)
```
