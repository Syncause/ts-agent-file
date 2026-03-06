@echo off
setlocal

REM ================================================
REM Probe Installation Script v1.6.0 (Windows)
REM This script automates the installation of the OpenTelemetry-based TS/JS Probe.
REM
REM It delegates all logic to install_probe.ps1 for reliability.
REM Requires: PowerShell 5.1+ (built-in on Windows 10/11) or pwsh (PowerShell 7+)
REM ================================================

REM --- Try to find PowerShell ---
set "PS_EXE="
where pwsh >nul 2>&1
if %errorlevel% equ 0 (
    set "PS_EXE=pwsh"
    goto :run
)
where powershell >nul 2>&1
if %errorlevel% equ 0 (
    set "PS_EXE=powershell"
    goto :run
)
echo ERROR: PowerShell not found. Please install PowerShell from https://aka.ms/powershell
exit /b 1

:run
REM --- Download install_probe.ps1 if not already present ---
set "TAG=%~1"
if "%TAG%"=="" set "TAG=v1.6.0"
set "PS1_URL=https://raw.githubusercontent.com/Syncause/ts-agent-file/%TAG%/install_probe.ps1"
set "PS1_FILE=%~dp0install_probe.ps1"

if not exist "%PS1_FILE%" (
    echo [34m==^>[0m Downloading install_probe.ps1 from GitHub (tag: %TAG%)...
    %PS_EXE% -NoProfile -ExecutionPolicy Bypass -Command ^
        "Invoke-WebRequest -Uri '%PS1_URL%' -OutFile '%PS1_FILE%' -UseBasicParsing"
    if %errorlevel% neq 0 (
        echo [31mERROR:[0m Failed to download install_probe.ps1.
        echo Please check your network connection and that the version tag '%TAG%' exists.
        exit /b 1
    )
)

REM --- Run the PowerShell installer ---
echo [34m==^>[0m Running installer via PowerShell (%PS_EXE%)...
%PS_EXE% -NoProfile -ExecutionPolicy Bypass -File "%PS1_FILE%" %TAG%
set "EXIT_CODE=%errorlevel%"

endlocal
exit /b %EXIT_CODE%
