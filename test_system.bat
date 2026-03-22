@echo off
REM NullShare v2.0 — Complete System Test Script
REM This script tests all major features and logs results

setlocal enabledelayedexpansion
set "LOG_FILE=nullshare_test_results.txt"
set "PASS=0"
set "FAIL=0"

echo. > %LOG_FILE%
echo ============================================ >> %LOG_FILE%
echo NullShare v2.0 — System Test Results >> %LOG_FILE%
echo ============================================ >> %LOG_FILE%
echo Test Date: %date% %time% >> %LOG_FILE%
echo. >> %LOG_FILE%

REM ─── Test 1: Server Health ───────────────────────────────────────────────────
echo [TEST 1] Server Health Check...
curl -s http://localhost:3000/health > nul 2>&1
if %errorlevel% equ 0 (
    echo ✓ PASS: Server is running >> %LOG_FILE%
    set /a PASS+=1
    echo ✓ PASS: Server is running
) else (
    echo ✗ FAIL: Server not responding >> %LOG_FILE%
    set /a FAIL+=1
    echo ✗ FAIL: Server not responding
    echo. >> %LOG_FILE%
    echo ERROR: Server must be running. Run start.bat first. >> %LOG_FILE%
    goto :end
)

REM ─── Test 2: Dashboard Access ────────────────────────────────────────────────
echo [TEST 2] Dashboard Access...
curl -s http://localhost:3000 | find "NullShare" > nul 2>&1
if %errorlevel% equ 0 (
    echo ✓ PASS: Dashboard loads >> %LOG_FILE%
    set /a PASS+=1
    echo ✓ PASS: Dashboard loads
) else (
    echo ✗ FAIL: Dashboard not loading >> %LOG_FILE%
    set /a FAIL+=1
    echo ✗ FAIL: Dashboard not loading
)

REM ─── Test 3: Create Test Share ───────────────────────────────────────────────
echo [TEST 3] Create Share...
REM Create a temporary test folder
if not exist "test_share_folder" mkdir test_share_folder
echo test file > test_share_folder\test.txt

REM Create share via API
for /f "tokens=*" %%A in ('curl -s -X POST http://localhost:3000/api/shares ^
  -H "Content-Type: application/json" ^
  -d "{\"folderPath\":\"test_share_folder\",\"label\":\"Test\",\"permission\":\"download\",\"password\":\"test123\"}" ^
  ^| find "token"') do (
    set "RESPONSE=%%A"
)

if not "!RESPONSE!"=="" (
    echo ✓ PASS: Share created >> %LOG_FILE%
    set /a PASS+=1
    echo ✓ PASS: Share created
) else (
    echo ✗ FAIL: Could not create share >> %LOG_FILE%
    set /a FAIL+=1
    echo ✗ FAIL: Could not create share
)

REM ─── Test 4: List Shares ────────────────────────────────────────────────────
echo [TEST 4] List Shares...
curl -s http://localhost:3000/api/shares | find "Test" > nul 2>&1
if %errorlevel% equ 0 (
    echo ✓ PASS: Shares listed >> %LOG_FILE%
    set /a PASS+=1
    echo ✓ PASS: Shares listed
) else (
    echo ✗ FAIL: Could not list shares >> %LOG_FILE%
    set /a FAIL+=1
    echo ✗ FAIL: Could not list shares
)

REM ─── Test 5: Get Logs ───────────────────────────────────────────────────────
echo [TEST 5] Get Logs...
curl -s http://localhost:3000/api/shares/logs/all | find "action" > nul 2>&1
if %errorlevel% equ 0 (
    echo ✓ PASS: Logs retrieved >> %LOG_FILE%
    set /a PASS+=1
    echo ✓ PASS: Logs retrieved
) else (
    echo ✗ FAIL: Could not retrieve logs >> %LOG_FILE%
    set /a FAIL+=1
    echo ✗ FAIL: Could not retrieve logs
)

REM ─── Test 6: Database Check ────────────────────────────────────────────────
echo [TEST 6] Database Check...
if exist "backend\data\nullshare.db" (
    echo ✓ PASS: Database exists >> %LOG_FILE%
    set /a PASS+=1
    echo ✓ PASS: Database exists
) else (
    echo ✗ FAIL: Database not found >> %LOG_FILE%
    set /a FAIL+=1
    echo ✗ FAIL: Database not found
)

REM ─── Test 7: JWT Secret Check ───────────────────────────────────────────────
echo [TEST 7] JWT Secret Check...
if exist "backend\.env" (
    for /f "tokens=*" %%A in ('findstr /R "JWT_SECRET" backend\.env') do (
        set "JWT_LINE=%%A"
    )
    if not "!JWT_LINE!"=="" (
        echo ✓ PASS: JWT_SECRET configured >> %LOG_FILE%
        set /a PASS+=1
        echo ✓ PASS: JWT_SECRET configured
    ) else (
        echo ✗ FAIL: JWT_SECRET not found >> %LOG_FILE%
        set /a FAIL+=1
        echo ✗ FAIL: JWT_SECRET not found
    )
) else (
    echo ✗ FAIL: .env file not found >> %LOG_FILE%
    set /a FAIL+=1
    echo ✗ FAIL: .env file not found
)

REM ─── Test 8: Frontend Files Check ───────────────────────────────────────────
echo [TEST 8] Frontend Files Check...
if exist "frontend\sharer\index.html" (
    if exist "frontend\receiver\index.html" (
        echo ✓ PASS: Frontend files present >> %LOG_FILE%
        set /a PASS+=1
        echo ✓ PASS: Frontend files present
    ) else (
        echo ✗ FAIL: Receiver HTML missing >> %LOG_FILE%
        set /a FAIL+=1
        echo ✗ FAIL: Receiver HTML missing
    )
) else (
    echo ✗ FAIL: Sharer HTML missing >> %LOG_FILE%
    set /a FAIL+=1
    echo ✗ FAIL: Sharer HTML missing
)

REM ─── Test 9: Backend Files Check ────────────────────────────────────────────
echo [TEST 9] Backend Files Check...
if exist "backend\server.js" (
    if exist "backend\routes\shares.js" (
        if exist "backend\routes\access.js" (
            echo ✓ PASS: Backend files present >> %LOG_FILE%
            set /a PASS+=1
            echo ✓ PASS: Backend files present
        ) else (
            echo ✗ FAIL: access.js missing >> %LOG_FILE%
            set /a FAIL+=1
            echo ✗ FAIL: access.js missing
        )
    ) else (
        echo ✗ FAIL: shares.js missing >> %LOG_FILE%
        set /a FAIL+=1
        echo ✗ FAIL: shares.js missing
    )
) else (
    echo ✗ FAIL: server.js missing >> %LOG_FILE%
    set /a FAIL+=1
    echo ✗ FAIL: server.js missing
)

REM ─── Test 10: npm Dependencies ──────────────────────────────────────────────
echo [TEST 10] npm Dependencies Check...
if exist "backend\node_modules" (
    echo ✓ PASS: Dependencies installed >> %LOG_FILE%
    set /a PASS+=1
    echo ✓ PASS: Dependencies installed
) else (
    echo ✗ FAIL: Dependencies not installed >> %LOG_FILE%
    set /a FAIL+=1
    echo ✗ FAIL: Dependencies not installed
    echo. >> %LOG_FILE%
    echo FIX: Run 'cd backend && npm install' >> %LOG_FILE%
)

REM ─── Summary ────────────────────────────────────────────────────────────────
:end
echo. >> %LOG_FILE%
echo ============================================ >> %LOG_FILE%
echo Test Summary >> %LOG_FILE%
echo ============================================ >> %LOG_FILE%
echo PASSED: %PASS% >> %LOG_FILE%
echo FAILED: %FAIL% >> %LOG_FILE%
echo. >> %LOG_FILE%

if %FAIL% equ 0 (
    echo ✓ ALL TESTS PASSED >> %LOG_FILE%
    echo. >> %LOG_FILE%
    echo ✓ ALL TESTS PASSED
    echo.
    echo System is ready to use!
    echo Dashboard: http://localhost:3000
) else (
    echo ✗ SOME TESTS FAILED >> %LOG_FILE%
    echo. >> %LOG_FILE%
    echo ✗ SOME TESTS FAILED
    echo.
    echo Check %LOG_FILE% for details
)

echo.
echo Results saved to: %LOG_FILE%
echo.
pause
