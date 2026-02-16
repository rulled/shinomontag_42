param(
  [string]$SourceDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$TargetDir = "C:\bot",
  [string]$CaddyExe = "C:\caddy\caddy_windows_amd64.exe",
  [string]$CaddyConfigPath = "C:\caddy\Caddyfile",
  [string]$AppDomain,
  [string]$ApiDomain,
  [string]$AppServiceName = "botfather-app",
  [string]$CaddyServiceName = "botfather-caddy",
  [switch]$SkipSourceSync
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    throw "Run this script in an elevated PowerShell session (Run as Administrator)."
  }
}

function Get-EnvValue {
  param(
    [string]$EnvPath,
    [string]$Key
  )

  if (-not (Test-Path $EnvPath)) {
    return $null
  }

  $line = Get-Content $EnvPath | Where-Object { $_ -match "^\s*$([regex]::Escape($Key))=" } | Select-Object -First 1
  if (-not $line) {
    return $null
  }

  return ($line -replace "^\s*$([regex]::Escape($Key))=", "").Trim()
}

function Set-EnvValue {
  param(
    [string]$EnvPath,
    [string]$Key,
    [string]$Value
  )

  $lines = @()
  if (Test-Path $EnvPath) {
    $lines = Get-Content $EnvPath
  }

  $pattern = "^\s*$([regex]::Escape($Key))="
  $updated = $false
  for ($i = 0; $i -lt $lines.Count; $i += 1) {
    if ($lines[$i] -match $pattern) {
      $lines[$i] = "$Key=$Value"
      $updated = $true
      break
    }
  }

  if (-not $updated) {
    $lines += "$Key=$Value"
  }

  Set-Content -Path $EnvPath -Value $lines -Encoding ascii
}

function New-AppSecret {
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).Replace("=", "").Replace("/", "").Replace("+", "")
}

function Ensure-Service {
  param(
    [string]$Name,
    [string]$DisplayName,
    [string]$Description,
    [string]$BinaryPath
  )

  $existing = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $existing) {
    & sc.exe create $Name "binPath= $BinaryPath" "start= auto" "DisplayName= $DisplayName" | Out-Null
  } else {
    & sc.exe config $Name "binPath= $BinaryPath" "start= auto" "DisplayName= $DisplayName" | Out-Null
  }

  & sc.exe description $Name $Description | Out-Null
  & sc.exe failure $Name "reset= 86400" "actions= restart/5000/restart/5000/restart/5000" | Out-Null
}

function Restart-ServiceSafe {
  param([string]$Name)
  $service = Get-Service -Name $Name -ErrorAction Stop
  if ($service.Status -eq "Running") {
    Stop-Service -Name $Name -Force -ErrorAction Stop
    Start-Sleep -Seconds 2
  }
  Start-Service -Name $Name -ErrorAction Stop
}

function Wait-ForHealth {
  param([string]$Url)
  for ($attempt = 1; $attempt -le 45; $attempt += 1) {
    try {
      $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 3
      if ($response.ok -eq $true) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  return $false
}

Assert-Admin

Write-Step "Checking required binaries"
if (-not (Test-Path $CaddyExe)) {
  throw "Caddy binary was not found: $CaddyExe"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js was not found in PATH. Install Node.js 20+ first."
}
$nodeExe = $nodeCommand.Source

$npmCommand = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  throw "npm was not found in PATH."
}

if (-not (Test-Path $TargetDir)) {
  Write-Step "Creating target directory: $TargetDir"
  New-Item -ItemType Directory -Path $TargetDir | Out-Null
}

if (-not $SkipSourceSync) {
  $sourceFull = (Resolve-Path $SourceDir).Path.TrimEnd("\")
  $targetFull = (Resolve-Path $TargetDir).Path.TrimEnd("\")

  if ($sourceFull -ne $targetFull) {
    Write-Step "Syncing source to target"
    & robocopy $sourceFull $targetFull /E /R:2 /W:2 /XD node_modules data .git /XF .env server.log | Out-Null
    $rc = $LASTEXITCODE
    if ($rc -ge 8) {
      throw "robocopy failed with exit code $rc"
    }
  } else {
    Write-Step "Skipping source sync (source and target are the same path)"
  }
}

$envPath = Join-Path $TargetDir ".env"
$envExamplePath = Join-Path $TargetDir ".env.example"

if (-not (Test-Path $envPath)) {
  if (-not (Test-Path $envExamplePath)) {
    throw "Neither .env nor .env.example exists in $TargetDir"
  }
  Write-Step "Creating .env from .env.example"
  Copy-Item $envExamplePath $envPath
}

if (-not $AppDomain) {
  $appOrigin = Get-EnvValue -EnvPath $envPath -Key "APP_ORIGIN"
  if ($appOrigin -and $appOrigin.StartsWith("https://")) {
    $AppDomain = $appOrigin.Replace("https://", "")
  }
}

if (-not $ApiDomain) {
  $apiOrigin = Get-EnvValue -EnvPath $envPath -Key "API_ORIGIN"
  if ($apiOrigin -and $apiOrigin.StartsWith("https://")) {
    $ApiDomain = $apiOrigin.Replace("https://", "")
  }
}

if (-not $AppDomain -or -not $ApiDomain) {
  throw "Specify -AppDomain and -ApiDomain, or prefill APP_ORIGIN/API_ORIGIN in .env."
}

Write-Step "Updating .env values for domains and defaults"
Set-EnvValue -EnvPath $envPath -Key "MINI_APP_URL" -Value "https://$AppDomain"
Set-EnvValue -EnvPath $envPath -Key "APP_ORIGIN" -Value "https://$AppDomain"
Set-EnvValue -EnvPath $envPath -Key "API_ORIGIN" -Value "https://$ApiDomain"
Set-EnvValue -EnvPath $envPath -Key "PORT" -Value "3000"
Set-EnvValue -EnvPath $envPath -Key "DB_PATH" -Value "./data/app.db"
Set-EnvValue -EnvPath $envPath -Key "ALLOW_DEV_LOGIN" -Value "false"

$currentSecret = Get-EnvValue -EnvPath $envPath -Key "APP_SECRET"
if ([string]::IsNullOrWhiteSpace($currentSecret) -or $currentSecret -eq "change-this-secret") {
  Set-EnvValue -EnvPath $envPath -Key "APP_SECRET" -Value (New-AppSecret)
}

$adminIds = Get-EnvValue -EnvPath $envPath -Key "ADMIN_IDS"
if ([string]::IsNullOrWhiteSpace($adminIds)) {
  Write-Warning "ADMIN_IDS is empty in .env. Add Telegram user IDs for admin access."
}

Write-Step "Installing npm dependencies in $TargetDir"
Push-Location $TargetDir
try {
  if (Test-Path (Join-Path $TargetDir "package-lock.json")) {
    & npm ci --omit=dev
  } else {
    & npm install --omit=dev
  }
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

Write-Step "Preparing run command wrapper"
$logsDir = Join-Path $TargetDir "logs"
if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
}

$runCmdPath = Join-Path $TargetDir "run-app.cmd"
$runCmdContent = @(
  "@echo off",
  "cd /d $TargetDir",
  "`"$nodeExe`" `"$TargetDir\src\server.js`" >> `"$logsDir\app.out.log`" 2>> `"$logsDir\app.err.log`""
)
Set-Content -Path $runCmdPath -Value $runCmdContent -Encoding ascii

Write-Step "Generating Caddyfile: $CaddyConfigPath"
$caddyDir = Split-Path -Path $CaddyConfigPath -Parent
if (-not (Test-Path $caddyDir)) {
  New-Item -ItemType Directory -Path $caddyDir | Out-Null
}

$caddyfile = @"
$AppDomain, $ApiDomain {
  reverse_proxy 127.0.0.1:3000
}
"@
Set-Content -Path $CaddyConfigPath -Value $caddyfile -Encoding ascii

Write-Step "Configuring Windows services"
$appBin = "`"$env:ComSpec`" /c `"$runCmdPath`""
$caddyBin = "`"$CaddyExe`" run --config `"$CaddyConfigPath`" --adapter caddyfile"

Ensure-Service -Name $AppServiceName `
  -DisplayName "BotFather App" `
  -Description "Telegram tire fitting mini app backend" `
  -BinaryPath $appBin

Ensure-Service -Name $CaddyServiceName `
  -DisplayName "BotFather Caddy" `
  -Description "Caddy reverse proxy for BotFather app/api domains" `
  -BinaryPath $caddyBin

Write-Step "Restarting services"
Restart-ServiceSafe -Name $AppServiceName
Restart-ServiceSafe -Name $CaddyServiceName

Write-Step "Checking backend health"
$healthOk = Wait-ForHealth -Url "http://127.0.0.1:3000/api/health"
if (-not $healthOk) {
  throw "Health check failed: http://127.0.0.1:3000/api/health"
}

Write-Host ""
Write-Host "Deploy completed." -ForegroundColor Green
Write-Host "App path:     $TargetDir"
Write-Host "Caddy binary: $CaddyExe"
Write-Host "Caddy config: $CaddyConfigPath"
Write-Host "Mini App URL: https://$AppDomain"
Write-Host "API URL:      https://$ApiDomain"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1) Put real BOT_TOKEN and ADMIN_IDS into $envPath (if not set yet)."
Write-Host "2) Verify HTTPS: https://$ApiDomain/api/health"
Write-Host "3) Set Mini App URL in @BotFather to https://$AppDomain"
