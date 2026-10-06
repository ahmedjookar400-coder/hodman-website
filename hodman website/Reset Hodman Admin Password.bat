@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto node_missing
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=5)?0:1)" >nul 2>&1
if errorlevel 1 goto node_old
node reset-admin-password.js
echo.
pause
exit /b

:node_missing
echo Windows cannot find Node.js (the "node" command) in its PATH.
echo Install Node.js 22.5 or newer, then close and reopen this tool.
pause
exit /b 1

:node_old
echo Node.js is installed, but this tool needs version 22.5 or newer.
echo Update Node.js, then close and reopen this tool.
pause
exit /b 1
