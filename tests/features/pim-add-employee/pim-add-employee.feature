# =============================================================================
# Feature      : PIM — Add Employee
# Module       : PIM (OrangeHRM React SPA)
# Route        : /web/index.php/pim/addEmployee
# Pages        : PimPage
# Components   : DataTableComponent, ToastComponent
# =============================================================================

Feature: PIM Add Employee
  As an HR administrator
  I want to add new employees through the PIM module
  So that their personal records exist in the system

  Background:
    Given I am signed in to OrangeHRM
    And I navigate to the "PIM" module

  @AI_SDLC-T201 @smoke @pim @create
  Scenario: Add a new employee with first and last name
    When I add an employee with first name "Alex" and last name "Turner"
    Then the employee should be saved successfully

  @AI_SDLC-T202 @pim @create @search
  Scenario: Added employee appears in the Employee List
    When I add an employee with first name "Priya" and last name "Nair"
    And I search the Employee List for "Priya"
    Then the employee "Priya" should appear in the results

  @AI_SDLC-T203 @pim @validation @negative
  Scenario: Require a last name to add an employee
    When I add an employee with first name "Sam" and no last name
    Then the employee should not be saved
