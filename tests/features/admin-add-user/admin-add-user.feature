# =============================================================================
# Feature      : Admin — Add User
# Module       : Admin (OrangeHRM React SPA)
# Route        : /web/index.php/admin/saveSystemUser
# Pages        : AdminPage
# Components   : DataTableComponent, ToastComponent
# =============================================================================

Feature: Admin Add User
  As an OrangeHRM administrator
  I want to create system user accounts
  So that employees can sign in with the right role

  Background:
    Given I am signed in to OrangeHRM
    And I navigate to the "Admin" module

  @AI_SDLC-T301 @smoke @admin @create
  Scenario: Create an enabled ESS user for an existing employee
    When I add a user with role "ESS" for employee "Admin" username "j.doe.101" and password "Passw0rd!123"
    Then the user should be saved successfully

  @AI_SDLC-T302 @admin @create @search
  Scenario: Created user appears in User Management
    When I add a user with role "Admin" for employee "Admin" username "a.admin.202" and password "Passw0rd!123"
    And I search User Management for username "a.admin.202"
    Then the user "a.admin.202" should appear in the results
