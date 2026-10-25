$ErrorActionPreference = 'Stop'

$configPath = 'wrangler.admin-test.toml'
$persistPath = 'migration\.admin-test-state'
$schemaPath = 'migration\d1-schema.sql'
$importPath = 'migration\output\d1-import.sql'
$fixturePath = Join-Path $persistPath 'fixtures\admin-test-image.png'
$fixtureKey = 'spadez-blackjack-admin-test-local/00000000-0000-4000-8000-000000000001.png'
$persistAbsolutePath = Join-Path (Get-Location) $persistPath
$config = Get-Content -Raw $configPath

$hasExpectedName = $config -match '(?m)^name\s*=\s*"spadez-blackjack-admin-test"\s*$'
$hasDisabledWorkersDev = $config -match '(?m)^workers_dev\s*=\s*false\s*$'
$hasLocalOnlyGuard = $config -match '(?m)^ADMIN_TEST_LOCAL_ONLY\s*=\s*"true"\s*$'
$referencesProductionResources = $config -match '33a87ffc-fc5f-4d64-b836-b954f5555691|spadez-content|database_name\s*=\s*"spadez-blackjack"'
if (-not $hasExpectedName -or -not $hasDisabledWorkersDev -or -not $hasLocalOnlyGuard -or $referencesProductionResources) {
  throw 'Admin test configuration is not isolated from production resources.'
}
if (-not (Test-Path -LiteralPath $schemaPath -PathType Leaf)) {
  throw 'Missing D1 schema at migration\d1-schema.sql.'
}
if (-not (Test-Path -LiteralPath $importPath -PathType Leaf)) {
  throw 'Missing validated import SQL at migration\output\d1-import.sql.'
}
if (Test-Path -LiteralPath $persistAbsolutePath) {
  throw 'Admin test local state already exists. Stop and inspect it; this script will not overwrite it.'
}

New-Item -ItemType Directory -Path (Split-Path -Parent (Join-Path (Get-Location) $fixturePath)) -Force | Out-Null

& node_modules\.bin\wrangler.cmd d1 execute spadez-blackjack-admin-test-local --local --config $configPath --persist-to $persistPath --file $schemaPath *> $null
if ($LASTEXITCODE -ne 0) { throw 'Local Admin test schema initialization failed; inspect local state before retrying.' }

& node_modules\.bin\wrangler.cmd d1 execute spadez-blackjack-admin-test-local --local --config $configPath --persist-to $persistPath --file $importPath *> $null
if ($LASTEXITCODE -ne 0) { throw 'Local validated Admin test data import failed; inspect local state before retrying.' }

$pngBytes = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pysAAAAASUVORK5CYII=')
[System.IO.File]::WriteAllBytes((Join-Path (Get-Location) $fixturePath), $pngBytes)

& node_modules\.bin\wrangler.cmd r2 object put $fixtureKey --local --config $configPath --persist-to $persistPath --file $fixturePath --content-type image/png *> $null
if ($LASTEXITCODE -ne 0) { throw 'Local Admin test R2 fixture setup failed; inspect local state before retrying.' }

$countSql = "SELECT 'catalog_items' AS table_name, COUNT(*) AS row_count FROM catalog_items UNION ALL SELECT 'catalog_state', COUNT(*) FROM catalog_state UNION ALL SELECT 'admin_codes', COUNT(*) FROM admin_codes UNION ALL SELECT 'admin_pin_attempts', COUNT(*) FROM admin_pin_attempts;"
$countOutput = & node_modules\.bin\wrangler.cmd d1 execute spadez-blackjack-admin-test-local --local --config $configPath --persist-to $persistPath --command $countSql --json
if ($LASTEXITCODE -ne 0) { throw 'Local Admin test row-count validation failed.' }
$countResult = ($countOutput -join "`n") | ConvertFrom-Json
$counts = @{}
foreach ($row in $countResult[0].results) {
  $counts[$row.table_name] = [int]$row.row_count
}
if (($counts.Count -ne 4) -or ($counts['catalog_items'] -ne 164) -or ($counts['catalog_state'] -ne 1) -or ($counts['admin_codes'] -ne 5) -or ($counts['admin_pin_attempts'] -ne 6)) {
  throw 'Local Admin test row counts do not match validated source counts.'
}

$integritySql = 'SELECT COUNT(*) AS invalid_item_json FROM catalog_items WHERE NOT json_valid(data); SELECT COUNT(*) AS invalid_state_json FROM catalog_state WHERE NOT json_valid(section_config) OR NOT json_valid(theme_config);'
$integrityOutput = & node_modules\.bin\wrangler.cmd d1 execute spadez-blackjack-admin-test-local --local --config $configPath --persist-to $persistPath --command $integritySql --json
if ($LASTEXITCODE -ne 0) { throw 'Local Admin test JSON integrity check failed.' }
$integrityResult = ($integrityOutput -join "`n") | ConvertFrom-Json
if ([int]$integrityResult[0].results[0].invalid_item_json -ne 0 -or [int]$integrityResult[1].results[0].invalid_state_json -ne 0) {
  throw 'Local Admin test state contains invalid catalog or theme JSON.'
}

Write-Output "Isolated local Admin test state prepared under $persistPath."
Write-Output "Verified row counts: catalog_items=$($counts['catalog_items']), catalog_state=$($counts['catalog_state']), admin_codes=$($counts['admin_codes']), admin_pin_attempts=$($counts['admin_pin_attempts'])."
Write-Output 'Catalog and theme JSON integrity verified. Admin hash values were not displayed.'
Write-Output 'Only local Wrangler D1/R2 emulators were accessed; no remote Cloudflare resources were used.'
