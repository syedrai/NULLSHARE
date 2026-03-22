@echo off
title NullShare — Windows TLS Setup
setlocal enabledelayedexpansion

echo ╔═══════════════════════════════════════════╗
echo ║   NullShare — Windows TLS Setup (mkcert)  ║
echo ╚═══════════════════════════════════════════╝
echo.

:: ── Check mode arg ────────────────────────────────────────────────────────────
set MODE=%1
if "%MODE%"=="" set MODE=local

if /i "%MODE%"=="local" goto :local_mode
if /i "%MODE%"=="info"  goto :info_mode
echo Usage: setup-tls-windows.bat [local^|info]
echo   local  ^— mkcert self-signed cert for LAN/dev (default)
echo   info   ^— show how to point devices to this server
exit /b 1

:: ─────────────────────────────────────────────────────────────────────────────
:local_mode
echo [*] Mode: Local LAN / Development (mkcert)
echo.

:: Check for admin
net session >nul 2>&1
if errorlevel 1 (
    echo [!] This script needs Administrator privileges to install the local CA.
    echo     Right-click and choose "Run as administrator"
    pause & exit /b 1
)

:: ── Check / install mkcert via winget or choco ────────────────────────────────
where mkcert >nul 2>&1
if errorlevel 1 (
    echo [*] mkcert not found. Attempting install...
    where winget >nul 2>&1
    if not errorlevel 1 (
        echo [*] Installing via winget...
        winget install FiloSottile.mkcert --silent
    ) else (
        where choco >nul 2>&1
        if not errorlevel 1 (
            echo [*] Installing via Chocolatey...
            choco install mkcert -y
        ) else (
            echo [!] Neither winget nor Chocolatey found.
            echo     Install mkcert manually from: https://github.com/FiloSottile/mkcert/releases
            echo     Download mkcert-v1.4.4-windows-amd64.exe, rename to mkcert.exe, add to PATH
            pause & exit /b 1
        )
    )
    :: Refresh PATH
    call refreshenv >nul 2>&1
)

where mkcert >nul 2>&1
if errorlevel 1 (
    echo [!] mkcert still not found after install. Add it to PATH manually and re-run.
    pause & exit /b 1
)

echo [+] mkcert found.
echo.

:: ── Install local CA into Windows trust store ─────────────────────────────────
echo [*] Installing local Certificate Authority into Windows trust store...
mkcert -install
if errorlevel 1 (
    echo [!] CA install failed. Make sure you are running as Administrator.
    pause & exit /b 1
)
echo [+] Local CA installed.
echo.

:: ── Get local IP ──────────────────────────────────────────────────────────────
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "169.254"') do (
    set LOCAL_IP=%%a
    set LOCAL_IP=!LOCAL_IP: =!
    goto :got_ip
)
:got_ip
echo [*] Detected local IP: %LOCAL_IP%
echo.

:: ── Create certs directory ────────────────────────────────────────────────────
set CERT_DIR=%~dp0..\backend\certs
if not exist "%CERT_DIR%" mkdir "%CERT_DIR%"

:: ── Generate certificate ──────────────────────────────────────────────────────
echo [*] Generating TLS certificate for:
echo     localhost, 127.0.0.1, %LOCAL_IP%, nullshare.local
echo.

cd /d "%CERT_DIR%"
mkcert -cert-file nullshare.pem -key-file nullshare-key.pem localhost 127.0.0.1 %LOCAL_IP% nullshare.local

if errorlevel 1 (
    echo [!] Certificate generation failed.
    pause & exit /b 1
)

echo.
echo [+] Certificates generated:
echo     Cert : %CERT_DIR%\nullshare.pem
echo     Key  : %CERT_DIR%\nullshare-key.pem
echo.

:: ── Update .env ───────────────────────────────────────────────────────────────
set ENV_FILE=%~dp0..\backend\.env
if exist "%ENV_FILE%" (
    echo [*] Updating .env with TLS settings...
    powershell -Command "(Get-Content '%ENV_FILE%') -replace 'TLS_ENABLED=.*','TLS_ENABLED=true' | Set-Content '%ENV_FILE%'"
    powershell -Command "(Get-Content '%ENV_FILE%') -replace 'TLS_CERT=.*','TLS_CERT=./certs/nullshare.pem' | Set-Content '%ENV_FILE%'"
    powershell -Command "(Get-Content '%ENV_FILE%') -replace 'TLS_KEY=.*','TLS_KEY=./certs/nullshare-key.pem' | Set-Content '%ENV_FILE%'"
    powershell -Command "(Get-Content '%ENV_FILE%') -replace 'PUBLIC_URL=http://','PUBLIC_URL=https://' | Set-Content '%ENV_FILE%'"
    echo [+] .env updated.
) else (
    echo [!] .env not found — run start.bat first to generate it, then re-run this script.
)

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║  HTTPS is now configured!                                 ║
echo ║                                                           ║
echo ║  Dashboard : https://localhost:3000                       ║
echo ║  LAN access: https://%LOCAL_IP%:3000              ║
echo ║                                                           ║
echo ║  For other devices on your LAN:                          ║
echo ║    1. Visit https://%LOCAL_IP%:3000/mkcert-ca.crt ║
echo ║       (or copy rootCA.pem from mkcert -CAROOT)           ║
echo ║    2. Install the CA cert on the device                   ║
echo ║    3. Access via https://%LOCAL_IP%:3000          ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.
pause
exit /b 0

:: ─────────────────────────────────────────────────────────────────────────────
:info_mode
echo [*] mkcert CA root location:
mkcert -CAROOT
echo.
echo [*] To trust on Android: copy rootCA.pem to device, install via Settings ^> Security ^> Install certificate
echo [*] To trust on iOS: AirDrop rootCA.pem, then Settings ^> General ^> VPN ^> Certificate Trust Settings
echo.
pause
exit /b 0
