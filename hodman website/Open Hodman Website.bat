@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto open_site

where node >nul 2>&1
if errorlevel 1 goto node_missing
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=5)?0:1)" >nul 2>&1
if errorlevel 1 goto node_old

echo Starting the Hodman website...
start "Hodman Website Server" /min cmd /k "cd /d ""%~dp0"" && node server.js"
set attempt=0

:wait_for_server
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto open_site
set /a attempt+=1
if %attempt% LSS 15 goto wait_for_server

echo The website did not start. Check that Node.js 22.5 or newer is installed.
pause
exit /b 1

:node_missing
echo Windows cannot find Node.js (the "node" command) in its PATH.
echo Install Node.js 22.5 or newer, then close and reopen this tool.
pause
exit /b 1

:node_old
echo Node.js is installed, but this website needs version 22.5 or newer.
echo Update Node.js, then close and reopen this tool.
pause
exit /b 1

:open_site
start "" "http://localhost:3000/"
exit /b 0
