@echo off
setlocal
chcp 65001 >nul

echo ==========================================
echo Calamelle - Diagnostic Brevo SMTP / DNS
echo ==========================================
echo.
echo [1/4] DNS systeme Windows
nslookup smtp-relay.brevo.com
echo.
echo [2/4] DNS Cloudflare 1.1.1.1
nslookup smtp-relay.brevo.com 1.1.1.1
echo.
echo [3/4] Port SMTP 587
powershell -NoProfile -Command "Test-NetConnection smtp-relay.brevo.com -Port 587 | Select-Object ComputerName,RemoteAddress,RemotePort,TcpTestSucceeded"
echo.
echo [4/4] Port SMTP alternatif 2525
powershell -NoProfile -Command "Test-NetConnection smtp-relay.brevo.com -Port 2525 | Select-Object ComputerName,RemoteAddress,RemotePort,TcpTestSucceeded"
echo.
echo Si le DNS systeme echoue mais 1.1.1.1 reussit, v1.8 utilise automatiquement le DNS de secours.
echo Si les deux DNS echouent, desactivez temporairement VPN/proxy ou modifiez le DNS Windows.
pause
