param(
  [switch]$GenerateOnly
)

$ErrorActionPreference = 'Stop'
$path = Join-Path (Get-Location) '.dev.vars'

function New-RandomHex {
  param([int]$ByteCount)
  $bytes = New-Object byte[] $ByteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
    return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  }
  finally {
    $generator.Dispose()
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}

function Convert-SecureStringToPlainText {
  param([System.Security.SecureString]$Value)
  $pointer = [IntPtr]::Zero
  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    if ($pointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
}

function Read-HiddenValue {
  param([string]$Prompt)
  $secureValue = Read-Host -Prompt $Prompt -AsSecureString
  try {
    return Convert-SecureStringToPlainText $secureValue
  }
  finally {
    $secureValue.Dispose()
  }
}

function Get-DevVarValue {
  param([string[]]$Lines, [string]$Key)
  $match = $Lines | Where-Object { $_ -match "^$([regex]::Escape($Key))=(.*)$" } | Select-Object -Last 1
  if ($null -eq $match) { return '' }
  return ($match -replace "^$([regex]::Escape($Key))=", '').Trim().Trim('"')
}

if ($GenerateOnly -and (Test-Path -LiteralPath $path)) {
  throw '.dev.vars already exists; refusing to replace any local values.'
}

$lines = @()
if (Test-Path -LiteralPath $path) {
  $lines = @(Get-Content -LiteralPath $path)
}

$pepper = Get-DevVarValue $lines 'PIN_PEPPER'
$sessionSecret = Get-DevVarValue $lines 'SESSION_SECRET'
if (-not $pepper) { $pepper = New-RandomHex 32 }
if (-not $sessionSecret) { $sessionSecret = New-RandomHex 32 }

if (-not $GenerateOnly) {
  do {
    $superAdminPin = Read-HiddenValue 'Enter the new local Super Admin PIN (4 digits; input is hidden)'
  } while ($superAdminPin -notmatch '^\d{4}$')

  do {
    $superAdminName = Read-HiddenValue 'Enter the local Super Admin display name (input is hidden)'
  } while ([string]::IsNullOrWhiteSpace($superAdminName) -or $superAdminName.Length -gt 80 -or $superAdminName -match '[\r\n]')
}

$keys = @('PIN_PEPPER', 'SESSION_SECRET', 'SUPER_ADMIN_PIN', 'SUPER_ADMIN_NAME')
$remainingLines = @($lines | Where-Object {
  $line = $_
  -not ($keys | Where-Object { $line -match "^$([regex]::Escape($_))=" })
})
$newLines = @(
  $remainingLines
  "PIN_PEPPER=$pepper"
  "SESSION_SECRET=$sessionSecret"
)
if (-not $GenerateOnly) {
  $escapedName = $superAdminName.Replace('\', '\\').Replace('"', '\"')
  $newLines += "SUPER_ADMIN_PIN=$superAdminPin"
  $newLines += "SUPER_ADMIN_NAME=`"$escapedName`""
}

$temporaryPath = "$path.$([guid]::NewGuid().ToString('N')).tmp"
try {
  [System.IO.File]::WriteAllLines(
    $temporaryPath,
    [string[]]$newLines,
    [System.Text.UTF8Encoding]::new($false)
  )
  Move-Item -LiteralPath $temporaryPath -Destination $path -Force
}
finally {
  if (Test-Path -LiteralPath $temporaryPath) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
}

if ($GenerateOnly) {
  Write-Output 'Generated and saved fresh local PIN_PEPPER and SESSION_SECRET in ignored .dev.vars. Secret values were not displayed.'
} else {
  Write-Output 'Saved local Admin test secrets in ignored .dev.vars. Secret values were not displayed.'
}
