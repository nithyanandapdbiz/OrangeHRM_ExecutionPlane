@echo off
REM ============================================================================
REM demo-dev-change-orangehrm.bat
REM   Wrapper around demo-dev-change.ps1 (OrangeHRM dev-change QA demo).
REM
REM Usage:
REM   scripts\demo-dev-change-orangehrm.bat                  default Scenario B
REM   scripts\demo-dev-change-orangehrm.bat -Scenario A      selector-drift demo
REM   scripts\demo-dev-change-orangehrm.bat -DryRun          plan only, no live run
REM   scripts\demo-dev-change-orangehrm.bat -KeepBranch -KeepServer
REM ============================================================================
setlocal
set SCRIPT_DIR=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%demo-dev-change.ps1" %*
exit /b %ERRORLEVEL%
