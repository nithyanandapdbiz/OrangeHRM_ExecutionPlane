# =============================================================================
# Feature      : Employee Login
# Module       : Auth (OrangeHRM React SPA)
# Route        : /web/index.php/auth/login
# Pages        : LoginPage, DashboardPage
# Components   : SideMenuComponent
# =============================================================================

Feature: Employee Login
  As an OrangeHRM user
  I want to sign in with my credentials
  So that the client router lands me on the Dashboard

  Background:
    Given the OrangeHRM login page is open

  @AI_SDLC-T101 @smoke @login @auth
  Scenario: Sign in with valid administrator credentials
    When I log in with the configured administrator credentials
    Then I should land on the Dashboard
    And the main menu should be visible

  @AI_SDLC-T102 @login @auth @negative
  Scenario: Reject sign-in with invalid credentials
    When I log in with username "Admin" and password "wrong-password"
    Then I should see an authentication error
    And I should remain on the login page

  @AI_SDLC-T103 @login @auth @validation
  Scenario: Require both credential fields
    When I submit the login form without entering credentials
    Then I should see required-field validation messages
