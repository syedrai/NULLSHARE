@echo off
title NullShare Launcher
cd /d "%~dp0backend"

:: ── Install deps if node_modules missing ─────────────────────────────────────
if not exist node_modules (
    echo [*] Installing dependencies...
    npm install
    if errorlevel 1 ( echo [!] npm install failed & pause & exit /b 1 )
)

:: ── Generate .env if missing ──────────────────────────────────────────────────
if not exist .env (
    echo [*] Creating .env from template...
    copy .env.example .env >nul
)

:: ── Generate new JWT_SECRET every time ────────────────────────────────────────
echo [*] Generating new JWT_SECRET...
for /f %%i in ('node -e "process.stdout.write(require('crypto').randomBytes(64).toString('hex'))"') do (
    powershell -command "(Get-Content .env) -replace 'JWT_SECRET=.*','JWT_SECRET=%%i' | Set-Content .env"
)
echo [+] JWT_SECRET regenerated

:: ── Start Cloudflare Tunnel in a new window ───────────────────────────────────
echo [*] Starting Cloudflare Tunnel...
set TUNNEL_LOG=%TEMP%\nullshare_tunnel.log
if exist "%TUNNEL_LOG%" del "%TUNNEL_LOG%"

start "NullShare Tunnel" cmd /c "C:\cloudflared\cloudflared.exe tunnel --url http://localhost:3000 --no-autoupdate > %TUNNEL_LOG% 2>&1"

:: ── Wait for tunnel URL to appear in log (up to 30s) ─────────────────────────
echo [*] Waiting for tunnel URL...
set TUNNEL_URL=
set /a WAIT=0
:waitloop
timeout /t 2 /nobreak >nul
set /a WAIT+=2
for /f "tokens=*" %%L in ('powershell -command "if (Test-Path '%TUNNEL_LOG%') { $m = Select-String -Path '%TUNNEL_LOG%' -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -Last 1; if ($m) { $m.Matches[0].Value } }"') do (
    set TUNNEL_URL=%%L
)
if "%TUNNEL_URL%"=="" (
    if %WAIT% LSS 30 goto waitloop
    echo [!] Tunnel URL not detected after 30s, starting without tunnel...
    goto startserver
)

:: ── Update PUBLIC_URL and ALLOWED_ORIGINS in .env ────────────────────────────
echo [+] Tunnel URL: %TUNNEL_URL%
powershell -command "(Get-Content .env) -replace 'PUBLIC_URL=.*','PUBLIC_URL=%TUNNEL_URL%' | Set-Content .env"
powershell -command "(Get-Content .env) -replace 'ALLOWED_ORIGINS=.*','ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,%TUNNEL_URL%' | Set-Content .env"
echo [+] PUBLIC_URL and ALLOWED_ORIGINS updated

:startserver
:: ── Start NullShare server ────────────────────────────────────────────────────
echo [*] Starting NullShare server...
echo.
echo  ==========================================
echo   Dashboard : http://localhost:3000
if not "%TUNNEL_URL%"=="" (
    echo   Public    : %TUNNEL_URL%
    echo   Share via : %TUNNEL_URL%/share/TOKEN
)
echo  ==========================================
echo.
node server.js
