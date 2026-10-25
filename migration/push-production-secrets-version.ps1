param(
  [switch]$ValidateOnly,
  [switch]$Approved
)

$ErrorActionPreference = 'Stop'

$varsPath = Join-Path (Get-Location) '.dev.vars'
$configPath = 'wrangler.bootstrap.toml'
$requiredKeys = @('PIN_PEPPER', 'SESSION_SECRET', 'SUPER_ADMIN_PIN', 'SUPER_ADMIN_NAME')

if (-not (Test-Path -LiteralPath $varsPath -PathType Leaf)) {
  throw 'Ignored .dev.vars is missing.'
}

$config = Get-Content -Raw -LiteralPath $configPath
$hasExpectedName = $config -match '(?m)^name\s*=\s*"spadez-blackjack"\s*$'
$hasNoWorkersDev = $config -match '(?m)^workers_dev\s*=\s*false\s*$'
$hasNoPreviewUrls = $config -match '(?m)^preview_urls\s*=\s*false\s*$'
if (-not $hasExpectedName -or -not $hasNoWorkersDev -or -not $hasNoPreviewUrls) {
  throw 'Bootstrap config is not the expected non-public production Worker config.'
}
if ($config -match 'd1_databases|r2_buckets|^\[assets\]') {
  throw 'Bootstrap must not bind production storage or assets.'
}

$secretValues = @{}
foreach ($key in $requiredKeys) {
  $line = Get-Content -LiteralPath $varsPath |
    Where-Object { $_ -match "^\s*$([regex]::Escape($key))\s*=" } |
    Select-Object -Last 1
  if (-not $line) { throw "Required local key $key is missing from .dev.vars." }

  $raw = ($line -replace "^\s*$([regex]::Escape($key))\s*=", '').Trim()
  if ($raw.StartsWith('"')) {
    try { $value = ConvertFrom-Json -InputObject $raw }
    catch { throw "Could not parse local key $key; value withheld." }
  } elseif ($raw.StartsWith("'") -and $raw.EndsWith("'") -and $raw.Length -ge 2) {
    $value = $raw.Substring(1, $raw.Length - 2)
  } else {
    $value = ($raw -replace '\s+#.*$', '').Trim()
  }
  if ([string]::IsNullOrWhiteSpace([string]$value)) {
    throw "Required local key $key is blank."
  }
  $secretValues[$key] = [string]$value
}
if ($secretValues['SUPER_ADMIN_PIN'] -notmatch '^\d{4}$') {
  throw 'Local SUPER_ADMIN_PIN must be exactly four digits.'
}

if ($ValidateOnly) {
  foreach ($key in @($secretValues.Keys)) { $secretValues[$key] = $null }
  Write-Output 'All four local secret keys parsed and validated; no Cloudflare request was made.'
  return
}

if (-not $Approved) {
  $confirmation = Read-Host 'This sends the four local secrets to the non-public bootstrap Worker as an undeployed version. Type STAGE-SECRETS to continue'
  if ($confirmation -cne 'STAGE-SECRETS') {
    foreach ($key in @($secretValues.Keys)) { $secretValues[$key] = $null }
    throw 'Secret staging was not confirmed.'
  }
}

$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$wranglerPath = Join-Path (Get-Location) 'node_modules\wrangler\bin\wrangler.js'
if (-not (Test-Path -LiteralPath $wranglerPath -PathType Leaf)) {
  throw 'Local Wrangler JavaScript entrypoint was not found.'
}

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $nodePath
$startInfo.Arguments = "`"$wranglerPath`" versions secret bulk --config $configPath"
$startInfo.WorkingDirectory = (Get-Location).Path
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $startInfo
$stdoutTask = $null
$stderrTask = $null

try {
  if (-not $process.Start()) { throw 'Could not start the local Wrangler process.' }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $json = $secretValues | ConvertTo-Json -Compress
  $process.StandardInput.WriteLine($json)
  $process.StandardInput.Close()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  if ($process.ExitCode -ne 0) {
    foreach ($value in $secretValues.Values) {
      if ($value.Length -ge 4) {
        $stdout = $stdout.Replace($value, '[REDACTED]')
        $stderr = $stderr.Replace($value, '[REDACTED]')
      }
    }
    throw "Wrangler failed to create a secret-only version (exit $($process.ExitCode)); output suppressed to protect secret material."
  }
  Write-Output 'Cloudflare accepted the secret-only version request. It was not deployed; no Worker traffic changed.'
}
finally {
  foreach ($key in @($secretValues.Keys)) { $secretValues[$key] = $null }
  $json = $null
  $stdout = $null
  $stderr = $null
  if ($process) { $process.Dispose() }
}
