@echo off
cd /d "%~dp0backend"
echo SOMSTAR Academy Backend Server
echo ===============================
echo.
echo After starting, open ONE of these in your browser:
echo   http://localhost:3000
echo   http://192.168.x.x:3000  (use the IP shown in terminal)
echo.
node server.js
pause
