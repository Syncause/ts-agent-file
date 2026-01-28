@echo off
setlocal enabledelayedexpansion

REM ================================================
REM Test File Wrapper Script v1.6.0 (Windows)
REM This script automates the wrapping of test files with probe instrumentation.
REM ================================================

REM --- Configuration ---
set "TAG=v1.6.0"
if not "%TAG_OVERRIDE%"=="" set "TAG=%TAG_OVERRIDE%"
set "GITHUB_BASE=https://raw.githubusercontent.com/Syncause/ts-agent-file/%TAG%"
set "SOURCE_DIR=%~1"
set "OUTPUT_DIR=%~2"

if "%SOURCE_DIR%"=="" set "SOURCE_DIR=__tests__"
if "%OUTPUT_DIR%"=="" set "OUTPUT_DIR=__tests_traced__"

echo [INFO] Using version tag: %TAG%
echo [INFO] Source directory: %SOURCE_DIR%
echo [INFO] Output directory: %OUTPUT_DIR%

REM --- Create directories ---
echo [INFO] Creating .syncause\scripts directory...
if not exist .syncause\scripts mkdir .syncause\scripts

REM --- Download components ---
echo [INFO] Downloading test probe components from GitHub...

echo [INFO] Downloading test-probe-runtime.ts...
curl -fsSL -o .syncause\test-probe-runtime.ts "%GITHUB_BASE%/test-probe-runtime.ts"
if errorlevel 1 (
    echo [ERROR] Failed to download test-probe-runtime.ts
    exit /b 1
)

echo [INFO] Downloading babel-plugin-test-probe.js...
curl -fsSL -o .syncause\scripts\babel-plugin-test-probe.js "%GITHUB_BASE%/babel-plugin-test-probe.js"
if errorlevel 1 (
    echo [ERROR] Failed to download babel-plugin-test-probe.js
    exit /b 1
)

echo [INFO] Downloading wrap-test-files.js...
curl -fsSL -o .syncause\scripts\wrap-test-files.js "%GITHUB_BASE%/wrap-test-files.js"
if errorlevel 1 (
    echo [ERROR] Failed to download wrap-test-files.js
    exit /b 1
)

echo [SUCCESS] All components downloaded successfully

REM --- Install dependencies ---
echo [INFO] Installing Babel dependencies...
call npm install -D @babel/parser @babel/traverse @babel/generator @babel/types 2>nul
if errorlevel 1 (
    echo [WARNING] Some dependencies may have failed to install
)

REM --- Wrap test files ---
echo [INFO] Wrapping test files from %SOURCE_DIR% to %OUTPUT_DIR%...
node .syncause\scripts\wrap-test-files.js "%SOURCE_DIR%" "%OUTPUT_DIR%"
if errorlevel 1 (
    echo [ERROR] Failed to wrap test files
    exit /b 1
)

echo [SUCCESS] Test files wrapped successfully

REM --- Clean up old span log ---
echo [INFO] Cleaning up old span.log...
if exist .syncause\span.log del /f /q .syncause\span.log

REM --- Run tests ---
echo [INFO] Running tests...
set "TEST_RUNNER_FOUND=0"

REM Try Jest
call npx jest "%OUTPUT_DIR%" --forceExit 2>nul
if not errorlevel 1 (
    echo [SUCCESS] Tests completed with Jest
    set "TEST_RUNNER_FOUND=1"
    goto :report_results
)

REM Try Vitest
call npx vitest run "%OUTPUT_DIR%" 2>nul
if not errorlevel 1 (
    echo [SUCCESS] Tests completed with Vitest
    set "TEST_RUNNER_FOUND=1"
    goto :report_results
)

REM Try Mocha
call npx mocha "%OUTPUT_DIR%\**\*.test.ts" 2>nul
if not errorlevel 1 (
    echo [SUCCESS] Tests completed with Mocha
    set "TEST_RUNNER_FOUND=1"
    goto :report_results
)

if "%TEST_RUNNER_FOUND%"=="0" (
    echo [ERROR] No test runner found or tests failed
    exit /b 1
)

:report_results
REM --- Report results ---
if exist .syncause\span.log (
    for /f %%A in ('type .syncause\span.log ^| find /c /v ""') do set SPAN_COUNT=%%A
    echo [SUCCESS] Span records: !SPAN_COUNT!
    
    if !SPAN_COUNT! gtr 0 (
        echo [SUCCESS] Test probe instrumentation is working correctly!
    ) else (
        echo [ERROR] No spans recorded. Check your test setup.
    )
) else (
    echo [ERROR] span.log not found. Instrumentation may not be working.
)

endlocal
