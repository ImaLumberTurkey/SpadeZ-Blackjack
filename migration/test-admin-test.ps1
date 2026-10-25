$ErrorActionPreference = 'Stop'
$baseUrl = 'http://127.0.0.1:8788'

function Invoke-LocalApi {
  param(
    [string]$Path,
    [string]$Method = 'GET',
    [object]$Body,
    [string]$Token,
    [string]$ContentType = 'application/json'
  )
  $headers = @{}
  if ($Token) { $headers.Authorization = "Bearer $Token" }
  $request = @{
    Uri = "$baseUrl$Path"
    Method = $Method
    Headers = $headers
    UseBasicParsing = $true
  }
  if ($null -ne $Body) {
    $request.Body = $Body
    $request.ContentType = $ContentType
  }
  try {
    $webResponse = Invoke-WebRequest @request
    $status = [int]$webResponse.StatusCode
    $content = [string]$webResponse.Content
  }
  catch [System.Net.WebException] {
    $webResponse = $_.Exception.Response
    if (-not $webResponse) { throw }
    $status = [int]$webResponse.StatusCode
    $reader = New-Object System.IO.StreamReader($webResponse.GetResponseStream())
    try {
      $content = $reader.ReadToEnd()
    }
    finally {
      $reader.Dispose()
      $webResponse.Close()
    }
  }
  $parsed = $null
  if ($content) {
    try { $parsed = $content | ConvertFrom-Json } catch { $parsed = $null }
  }
  return @{
    Status = $status
    Json = $parsed
    Content = $content
  }
}

function Assert-Status {
  param($Result, [int]$Expected, [string]$Action)
  if ($Result.Status -ne $Expected) {
    throw "$Action failed with HTTP $($Result.Status); response details suppressed."
  }
}

$devVarsPath = Join-Path (Get-Location) '.dev.vars'
if (-not (Test-Path -LiteralPath $devVarsPath -PathType Leaf)) {
  throw 'Ignored .dev.vars is missing; run the local Admin secret setup first.'
}
$pinLine = Get-Content -LiteralPath $devVarsPath | Where-Object { $_ -match '^SUPER_ADMIN_PIN=' } | Select-Object -Last 1
$superAdminPin = if ($pinLine) { ($pinLine -split '=', 2)[1].Trim().Trim('"') } else { '' }
if ($superAdminPin -notmatch '^\d{4}$') { throw 'PIN must be exactly four digits.' }

$createdAdminId = ''
$createdItemId = ''
$superToken = ''
$originalTheme = $null
$themeChanged = $false
try {
  $login = Invoke-LocalApi '/api/admin/verify' 'POST' (@{ pin = $superAdminPin } | ConvertTo-Json -Compress)
  Assert-Status $login 200 'Super Admin login'
  if (-not $login.Json.admin.isSuperAdmin) { throw 'Login did not produce a Super Admin session.' }
  $superToken = $login.Json.admin.token

  $before = Invoke-LocalApi '/api/admin/codes' 'GET' $null $superToken
  Assert-Status $before 200 'Super Admin Admin-management access'
  $beforeAdmins = @($before.Json.admins | ForEach-Object { "$($_.id)|$($_.name)" })
  if ($beforeAdmins.Count -ne 5) { throw 'Expected five original Admin records before the test; no record was changed.' }

  $random = New-Object byte[] 4
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($random) } finally { $rng.Dispose() }
  $newRegularPin = '{0:D4}' -f ([BitConverter]::ToUInt32($random, 0) % 10000)
  [Array]::Clear($random, 0, $random.Length)
  $newRegularName = "Local Admin Test $([guid]::NewGuid().ToString('N').Substring(0, 8))"
  $created = Invoke-LocalApi '/api/admin/codes' 'POST' (@{ name = $newRegularName; pin = $newRegularPin } | ConvertTo-Json -Compress) $superToken
  Assert-Status $created 201 'Creating a regular Admin with the new pepper'
  $createdAdminId = $created.Json.admin.id

  $regularLogin = Invoke-LocalApi '/api/admin/verify' 'POST' (@{ pin = $newRegularPin } | ConvertTo-Json -Compress)
  Assert-Status $regularLogin 200 'Login using newly created Admin PIN'
  if ($regularLogin.Json.admin.isSuperAdmin) { throw 'New regular Admin was incorrectly granted Super Admin permissions.' }
  $regularToken = $regularLogin.Json.admin.token

  $regularAdminManagement = Invoke-LocalApi '/api/admin/codes' 'GET' $null $regularToken
  Assert-Status $regularAdminManagement 401 'Regular Admin access to Super Admin management'
  $regularTheme = Invoke-LocalApi '/api/catalog/settings' 'PATCH' (@{ themeConfig = @{} } | ConvertTo-Json -Compress) $regularToken
  Assert-Status $regularTheme 401 'Regular Admin access to Super Admin theme settings'

  $catalog = Invoke-LocalApi '/api/catalog' 'GET'
  Assert-Status $catalog 200 'Catalog read'
  $section = $catalog.Json.catalog.PSObject.Properties | Select-Object -First 1
  if (-not $section) { throw 'No catalog section was available for the edit test.' }
  $itemBody = @{ item = @{ name = 'Local Admin Test Item'; section = $section.Name; description = "Before edit`nSecond line" } } | ConvertTo-Json -Depth 10 -Compress
  $itemCreate = Invoke-LocalApi '/api/catalog/items' 'POST' $itemBody $regularToken
  Assert-Status $itemCreate 201 'Catalog item creation'
  $createdItemId = $itemCreate.Json.item.id
  $itemPatchBody = @{ id = $createdItemId; item = @{ name = 'Local Admin Test Item'; section = $section.Name; description = "After edit`nSecond line" } } | ConvertTo-Json -Depth 10 -Compress
  $itemEdit = Invoke-LocalApi '/api/catalog/items' 'PATCH' $itemPatchBody $regularToken
  Assert-Status $itemEdit 200 'Catalog item editing'

  $png = [byte[]](137, 80, 78, 71, 13, 10, 26, 10)
  $imageUpload = Invoke-LocalApi '/api/catalog/image' 'POST' $png $regularToken 'image/png'
  Assert-Status $imageUpload 201 'Catalog image upload to local R2'
  if (-not $imageUpload.Json.image) { throw 'Image upload did not return an asset path.' }

  $oldTheme = $catalog.Json.themeConfig
  $originalTheme = $oldTheme
  $newTheme = $oldTheme | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  $newTheme.accentColor = '#123456'
  $themeBody = @{ themeConfig = $newTheme } | ConvertTo-Json -Depth 20 -Compress
  $themeChange = Invoke-LocalApi '/api/catalog/settings' 'PATCH' $themeBody $superToken
  Assert-Status $themeChange 200 'Super Admin theme editing'

  $backgroundUpload = Invoke-LocalApi '/api/catalog/theme-background' 'POST' $png $superToken 'image/png'
  Assert-Status $backgroundUpload 201 'Theme background upload to local R2'

  $restoreBody = @{ themeConfig = $oldTheme } | ConvertTo-Json -Depth 20 -Compress
  $restore = Invoke-LocalApi '/api/catalog/settings' 'PATCH' $restoreBody $superToken
  Assert-Status $restore 200 'Restoring local test theme'
  $themeChanged = $false

  $deleteItem = Invoke-LocalApi '/api/catalog/items' 'DELETE' (@{ id = $createdItemId } | ConvertTo-Json -Compress) $regularToken
  Assert-Status $deleteItem 200 'Removing temporary catalog test item'
  $createdItemId = ''

  $deleteAdmin = Invoke-LocalApi '/api/admin/codes' 'DELETE' (@{ id = $createdAdminId } | ConvertTo-Json -Compress) $superToken
  Assert-Status $deleteAdmin 200 'Removing temporary Admin test account'
  $createdAdminId = ''

  $after = Invoke-LocalApi '/api/admin/codes' 'GET' $null $superToken
  Assert-Status $after 200 'Verifying original Admin records remain unchanged'
  $afterAdmins = @($after.Json.admins | ForEach-Object { "$($_.id)|$($_.name)" })
  if ($beforeAdmins.Count -ne $afterAdmins.Count -or (Compare-Object $beforeAdmins $afterAdmins)) {
    throw 'The original Admin record list changed during the test.'
  }

  Write-Output 'Local Admin integration checks passed: Super Admin login/management/theme, regular Admin creation/login/catalog editing/image upload, role restrictions, and temporary test-record cleanup.'
  Write-Output 'The five original Admin IDs and names are unchanged. PIN hashes and secret values were not displayed.'
}
finally {
  try {
    if ($themeChanged -and $originalTheme -and $superToken) {
      $restoreBody = @{ themeConfig = $originalTheme } | ConvertTo-Json -Depth 20 -Compress
      $null = Invoke-LocalApi '/api/catalog/settings' 'PATCH' $restoreBody $superToken
    }
    if ($createdItemId -and $regularToken) {
      $null = Invoke-LocalApi '/api/catalog/items' 'DELETE' (@{ id = $createdItemId } | ConvertTo-Json -Compress) $regularToken
    }
    if ($createdAdminId -and $superToken) {
      $null = Invoke-LocalApi '/api/admin/codes' 'DELETE' (@{ id = $createdAdminId } | ConvertTo-Json -Compress) $superToken
    }
  } catch {
    Write-Warning 'Temporary local Admin test data may require manual cleanup; response details suppressed.'
  }
  $superAdminPin = $null
  $newRegularPin = $null
  $superToken = $null
}
