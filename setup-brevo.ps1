$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvPath = Join-Path $Root 'backend\.env'

Write-Host ''
Write-Host 'Calamelle — Brevo SMTP setup' -ForegroundColor DarkRed
Write-Host 'This stores the SMTP secret only in backend/.env (ignored by Git).' -ForegroundColor DarkGray
Write-Host ''

$SmtpUser = Read-Host 'Brevo SMTP login (Settings > SMTP & API > Login)'
if ([string]::IsNullOrWhiteSpace($SmtpUser)) {
  throw 'SMTP login is required.'
}

$SecureKey = Read-Host 'Brevo SMTP key' -AsSecureString
$Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
try {
  $SmtpPass = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Ptr)
}
if ([string]::IsNullOrWhiteSpace($SmtpPass)) {
  throw 'SMTP key is required.'
}

$Sender = Read-Host 'Verified sender e-mail [gftijnational@gmail.com]'
if ([string]::IsNullOrWhiteSpace($Sender)) {
  $Sender = 'gftijnational@gmail.com'
}

$JwtSecret = ([Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N'))

$Content = @"
PORT=4000
JWT_SECRET=$JwtSecret
FRONTEND_URL=http://localhost:5173

SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=$SmtpUser
SMTP_PASS=$SmtpPass
SMTP_SECURE=false
SMTP_STARTTLS=true
SMTP_TIMEOUT_MS=20000
EMAIL_FROM=Calamelle <$Sender>

OTP_EXPIRY_MINUTES=10
OTP_RESEND_SECONDS=60
OTP_MAX_ATTEMPTS=5
OTP_MAX_RESENDS=5
EXPOSE_DEV_OTP=false
"@

Set-Content -Path $EnvPath -Value $Content -Encoding UTF8
Write-Host ''
Write-Host 'Brevo SMTP configuration saved.' -ForegroundColor Green
Write-Host "File: $EnvPath" -ForegroundColor DarkGray
Write-Host ''
Write-Host 'Important: in Brevo, verify the sender/domain and authorize the public IP of the machine/server sending mail.' -ForegroundColor Yellow
Write-Host 'You can now run START_CALAMELLE.bat.' -ForegroundColor Green
Write-Host ''
