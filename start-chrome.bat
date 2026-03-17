@echo off
echo ===================================================
echo   Grasp - Starting Chrome with Remote Debug Port
echo ===================================================
echo.

:: Step 0: Check if curl is available
where curl >nul 2>&1
if errorlevel 1 (
  echo [WARN] curl not found, skipping port check...
  goto :find_chrome
)

:: Step 1: Check if port 9222 is already listening
curl -s http://localhost:9222/json/version >nul 2>&1
if not errorlevel 1 (
  echo [OK] Grasp Chrome is already running. Ready!
  goto :done
)

:: Step 2: Find Chrome executable
:find_chrome
set "CHROME_EXE="

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
  set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
  goto :found
)

if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
  set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
  goto :found
)

if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
  goto :found
)

echo [ERROR] Chrome not found. Please install Chrome or set CHROME_EXE manually.
pause
exit /b 1

:found
echo [OK] Found Chrome: %CHROME_EXE%
echo [*] Starting Grasp Chrome (dedicated profile)...
echo.

:: Step 3: Launch Chrome with remote debugging
start "" "%CHROME_EXE%" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\chrome-grasp" --no-first-run --no-default-browser-check --start-maximized

:: Step 4: Wait for port to be ready (max 15 attempts)
echo [*] Waiting for Chrome to be ready...
set "TRIES=0"

:wait_loop
timeout /t 1 /nobreak >nul
curl -s http://localhost:9222/json/version >nul 2>&1
if not errorlevel 1 goto :ready
set /a TRIES=TRIES+1
if %TRIES% LSS 15 goto :wait_loop

echo [ERROR] Chrome did not start in time.
pause
exit /b 1

:ready
:: Step 5: Success
echo [OK] Grasp Chrome is ready!
echo.
echo NOTE: This is a dedicated browser window for AI control.
echo       First time? Please log in to your accounts here - logins are saved permanently.

:done
echo.
pause
