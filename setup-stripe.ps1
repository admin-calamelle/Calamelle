$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendEnv = Join-Path $ProjectRoot 'backend\.env'
$BackendExample = Join-Path $ProjectRoot 'backend\.env.example'

if (-not (Test-Path $BackendEnv)) {
  if (Test-Path $BackendExample) {
    Copy-Item $BackendExample $BackendEnv
  } else {
    New-Item -ItemType File -Path $BackendEnv | Out-Null
  }
}

Write-Host ''
Write-Host 'Calamelle - Stripe setup' -ForegroundColor DarkRed
Write-Host 'Create the Products/Prices in Stripe first, then paste the test/live keys below.'
Write-Host ''

$Secret = Read-Host 'Stripe secret key (sk_test_... or sk_live_...)'
$Webhook = Read-Host 'Stripe webhook secret (whsec_...) - may be left empty for now'
$Monthly = Read-Host 'Monthly Price ID - EUR 4.99/month (price_...)'
$Annual = Read-Host 'Annual Price ID - EUR 34.99/year (price_...)'
$Naturalisation = Read-Host 'Naturalisation Pass Price ID - EUR 24.99 one-time (price_...)'
$Lifetime = Read-Host 'Founder Lifetime Price ID - EUR 59 one-time (price_...)'

function Set-EnvValue([string]$Path, [string]$Name, [string]$Value) {
  $lines = @(Get-Content $Path -ErrorAction SilentlyContinue)
  $pattern = "^$([regex]::Escape($Name))="
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) {
      $lines[$i] = "$Name=$Value"
      $found = $true
      break
    }
  }
  if (-not $found) { $lines += "$Name=$Value" }
  Set-Content -Path $Path -Value $lines -Encoding UTF8
}

Set-EnvValue $BackendEnv 'PAYMENTS_MODE' 'stripe'
Set-EnvValue $BackendEnv 'STRIPE_SECRET_KEY' $Secret
Set-EnvValue $BackendEnv 'STRIPE_WEBHOOK_SECRET' $Webhook
Set-EnvValue $BackendEnv 'STRIPE_PRICE_MONTHLY' $Monthly
Set-EnvValue $BackendEnv 'STRIPE_PRICE_ANNUAL' $Annual
Set-EnvValue $BackendEnv 'STRIPE_PRICE_NATURALISATION' $Naturalisation
Set-EnvValue $BackendEnv 'STRIPE_PRICE_LIFETIME' $Lifetime

Write-Host ''
Write-Host 'Stripe settings saved to backend/.env.' -ForegroundColor Green
Write-Host 'Restart Calamelle after changing .env.'
Write-Host ''
Write-Host 'Local webhook test:' -ForegroundColor Yellow
Write-Host '  stripe listen --forward-to localhost:4000/api/stripe/webhook'
Write-Host 'Then copy the whsec_... value into STRIPE_WEBHOOK_SECRET.'
Write-Host ''
