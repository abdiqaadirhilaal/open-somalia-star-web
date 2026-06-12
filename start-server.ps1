Write-Host "SOMSTAR Academy Backend Server" -ForegroundColor Green
Write-Host "===============================" -ForegroundColor Green
Write-Host ""
Write-Host "After starting, open ONE of these in your browser:" -ForegroundColor Yellow
Write-Host "  http://localhost:3000" -ForegroundColor Cyan
Write-Host "  http://192.168.x.x:3000  (use the IP shown in terminal)" -ForegroundColor Cyan
Write-Host ""
Set-Location "$PSScriptRoot\backend"
node server.js
