$ErrorActionPreference = 'Stop'

$previewConfig = 'wrangler.preview.toml'
$persistPath = 'migration\.preview-state'
$schemaPath = 'migration\d1-schema.sql'
$importPath = 'migration\output\d1-import.sql'
$fixturesPath = Join-Path $persistPath 'fixtures'
$fixturePath = Join-Path $fixturesPath 'preview-test-image.png'
$fixtureKey = 'spadez-content/00000000-0000-4000-8000-000000000001.png'

if (-not (Test-Path -LiteralPath $importPath -PathType Leaf)) {
  throw 'Missing validated import SQL at migration\output\d1-import.sql.'
}

$persistAbsolutePath = Join-Path (Get-Location) $persistPath
if (Test-Path -LiteralPath $persistAbsolutePath) {
  throw 'Preview local D1 state already exists. Stop and inspect it; this script will not overwrite it.'
}

New-Item -ItemType Directory -Path $fixturesPath -Force | Out-Null

& node_modules\.bin\wrangler.cmd d1 execute spadez-blackjack --local --config $previewConfig --persist-to $persistPath --file $schemaPath
if ($LASTEXITCODE -ne 0) { throw 'Local preview schema initialization failed; inspect local state before retrying.' }

& node_modules\.bin\wrangler.cmd d1 execute spadez-blackjack --local --config $previewConfig --persist-to $persistPath --file $importPath
if ($LASTEXITCODE -ne 0) { throw 'Local preview data initialization failed; inspect local state before retrying.' }

$pngBytes = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pysAAAAASUVORK5CYII=')
[System.IO.File]::WriteAllBytes((Join-Path (Get-Location) $fixturePath), $pngBytes)

& node_modules\.bin\wrangler.cmd r2 object put $fixtureKey --local --config $previewConfig --persist-to $persistPath --file $fixturePath --content-type image/png
if ($LASTEXITCODE -ne 0) { throw 'Local preview R2 fixture setup failed; inspect local state before retrying.' }

$countSql = "SELECT 'catalog_items' AS table_name, COUNT(*) AS row_count FROM catalog_items UNION ALL SELECT 'catalog_state', COUNT(*) FROM catalog_state UNION ALL SELECT 'admin_codes', COUNT(*) FROM admin_codes UNION ALL SELECT 'admin_pin_attempts', COUNT(*) FROM admin_pin_attempts;"
$countOutput = & node_modules\.bin\wrangler.cmd d1 execute spadez-blackjack --local --config $previewConfig --persist-to $persistPath --command $countSql --json
if ($LASTEXITCODE -ne 0) { throw 'Local preview row-count validation failed.' }
$countResult = ($countOutput -join "`n") | ConvertFrom-Json
$counts = @{}
foreach ($row in $countResult[0].results) {
  $counts[$row.table_name] = [int]$row.row_count
}
if (($counts.Count -ne 4) -or ($counts['catalog_items'] -ne 164) -or ($counts['catalog_state'] -ne 1) -or ($counts['admin_codes'] -ne 5) -or ($counts['admin_pin_attempts'] -ne 6)) {
  throw 'Local preview row counts do not match validated source counts.'
}

$integritySql = 'SELECT COUNT(*) AS invalid_item_json FROM catalog_items WHERE NOT json_valid(data); SELECT COUNT(*) AS invalid_state_json FROM catalog_state WHERE NOT json_valid(section_config) OR NOT json_valid(theme_config);'
$integrityOutput = & node_modules\.bin\wrangler.cmd d1 execute spadez-blackjack --local --config $previewConfig --persist-to $persistPath --command $integritySql --json
if ($LASTEXITCODE -ne 0) { throw 'Local preview JSON integrity check failed.' }
$integrityResult = ($integrityOutput -join "`n") | ConvertFrom-Json
$invalidItemJson = [int]$integrityResult[0].results[0].invalid_item_json
$invalidStateJson = [int]$integrityResult[1].results[0].invalid_state_json
if ($invalidItemJson -ne 0 -or $invalidStateJson -ne 0) {
  throw 'Local preview contains invalid catalog or theme JSON.'
}

Write-Output "Local read-only preview test state prepared under $persistPath."
Write-Output "R2 fixture key: 00000000-0000-4000-8000-000000000001.png"
Write-Output "Verified table counts: catalog_items=$($counts['catalog_items']), catalog_state=$($counts['catalog_state']), admin_codes=$($counts['admin_codes']), admin_pin_attempts=$($counts['admin_pin_attempts'])."
Write-Output 'JSON integrity verified for catalog items and state.'
Write-Output 'The preview configuration guard blocks every write request before D1/R2 bindings are accessed.'
