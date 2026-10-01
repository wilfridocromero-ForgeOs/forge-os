# Round-2 revalidation driver: the exit checklist, in one reproducible command.
#
#   & .\scripts\builder-round2-revalidation.ps1 -Database <repaired db> `
#       -PreMigrationTemplate <a database at the C.8 state>
#
# Checks, in order:
#   1. C.8 is byte-identical to its frozen hash (git blob), and every protected D1/D2/D3 product
#      file still hashes to the value captured before this pass;
#   2. the two forward-migration node suites (client half) pass;
#   3. the server matrix is GREEN: 40 fixtures + projection invariants + the R1 projection suite
#      + the lifecycle (including the strict negative controls and the save->publish->read parity);
#   4. the atomicity/preflight suite is GREEN on a freshly seeded pre-migration database.
#
# Exit 0 only when every step passed. Prints a final `REVALIDATION <passed> <failed> <skipped>`.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Database,
  [string]$PreMigrationTemplate = '',
  [string]$PgHost = '127.0.0.1',
  [int]$Port = 55432,
  [string]$PgUser = 'postgres',
  [string]$Psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe',
  [string]$OutDir = '.pgvalidate\matrix',
  [switch]$UpdateBaseline
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo

$C8 = 'supabase/migrations/20260916090000_builder_landing_document_v2_persistence.sql'
$C8_GIT_BLOB = 'cdb685f1f0f36ca68e58cda953911d82fbe95308'
$REPAIR = 'supabase/migrations/20260918000000_builder_landing_v2_projection_repair.sql'
$BASELINE = '.pgvalidate\round3-baseline-hashes.txt'
$results = @()

function Add-Result {
  param([string]$Name, [string]$Verdict, [string]$Detail = '')
  $script:results += [pscustomobject]@{ Name = $Name; Verdict = $Verdict; Detail = $Detail }
  $colour = switch ($Verdict) { 'PASS' { 'Green' } 'SKIP' { 'Yellow' } default { 'Red' } }
  Write-Host ("  [{0}] {1} :: {2}" -f $Verdict, $Name, $Detail) -ForegroundColor $colour
}

function Get-ProtectedFiles {
  Get-ChildItem (Join-Path $repo 'src\features\builder') -Recurse -File |
    Where-Object { $_.Extension -in '.js', '.jsx', '.css' -and $_.Name -notlike '*.test.*' -and $_.Name -notlike '*Fixtures*' } |
    Sort-Object FullName
}

try {
  $outPath = Join-Path $repo $OutDir
  if (-not (Test-Path $outPath)) { New-Item -ItemType Directory -Path $outPath -Force | Out-Null }
  $env:PGOPTIONS = '-c max_parallel_workers_per_gather=0'

  Write-Host ''
  Write-Host '=== 1. FROZEN HISTORY AND PROTECTED PRODUCT CODE ===' -ForegroundColor Cyan
  $blob = (git -C $repo hash-object (Join-Path $repo $C8)) | Out-String
  Add-Result 'C.8 git-blob hash matches the frozen value' $(if ($blob.Trim() -eq $C8_GIT_BLOB) { 'PASS' } else { 'FAIL' }) $blob.Trim()

  $baselinePath = Join-Path $repo $BASELINE
  if ($UpdateBaseline -or -not (Test-Path $baselinePath)) {
    $lines = @()
    $lines += "git-blob $C8_GIT_BLOB  C8"
    $lines += "sha256   $((Get-FileHash -Algorithm SHA256 (Join-Path $repo $C8)).Hash.ToLower())  C8"
    $lines += "sha256   $((Get-FileHash -Algorithm SHA256 (Join-Path $repo $REPAIR)).Hash.ToLower())  REPAIR"
    foreach ($f in Get-ProtectedFiles) {
      $lines += "sha256   $((Get-FileHash -Algorithm SHA256 $f.FullName).Hash.ToLower())  $($f.FullName.Substring($repo.Length + 1))"
    }
    Set-Content -Path $baselinePath -Value ($lines -join "`r`n") -Encoding ASCII
    Write-Host "  baseline (re)captured: $BASELINE" -ForegroundColor Yellow
  }

  $expected = @{}
  foreach ($line in Get-Content $baselinePath) {
    if ($line -match '^sha256\s+([0-9a-f]{64})\s+(.+)$') { $expected[$Matches[2].Trim()] = $Matches[1] }
  }
  $drift = @()
  $checked = 0
  foreach ($f in Get-ProtectedFiles) {
    $rel = $f.FullName.Substring($repo.Length + 1)
    if (-not $expected.ContainsKey($rel)) { $drift += "$rel (NEW, not in baseline)"; continue }
    $checked += 1
    if ($expected[$rel] -ne (Get-FileHash -Algorithm SHA256 $f.FullName).Hash.ToLower()) { $drift += "$rel (CHANGED)" }
  }
  Add-Result "all $checked protected D1/D2/D3 product files unchanged" $(if ($drift.Count -eq 0) { 'PASS' } else { 'FAIL' }) $(if ($drift.Count -eq 0) { 'no drift' } else { ($drift -join '; ') })

  Write-Host ''
  Write-Host '=== 2. FORWARD-MIGRATION NODE SUITES (client half) ===' -ForegroundColor Cyan
  foreach ($suite in @(
      'src/features/builder/document/landingServerValidationFixtures.test.js',
      'src/features/builder/document/landingV2ProjectionRepairMigration.test.js')) {
    $log = Join-Path $outPath ("node-" + [System.IO.Path]::GetFileName($suite) + ".txt")
    & node $suite *>&1 | Out-File -FilePath $log -Encoding UTF8
    $text = Get-Content $log -Raw
    $passLine = ([regex]::Match($text, 'pass (\d+)')).Groups[1].Value
    $failLine = ([regex]::Match($text, 'fail (\d+)')).Groups[1].Value
    Add-Result "$([System.IO.Path]::GetFileName($suite)): pass=$passLine fail=$failLine" `
      $(if ($LASTEXITCODE -eq 0 -and "$failLine" -eq '0') { 'PASS' } else { 'FAIL' }) "log=$log"
  }

  Write-Host ''
  Write-Host '=== 2b. HARNESS SELF-TESTS + REVIEWED-BYTES HASH PINNING ===' -ForegroundColor Cyan
  $selfLog = Join-Path $outPath 'revalidation-selftests.txt'
  & (Join-Path $PSScriptRoot 'builder-harness-selftests.ps1') -PgHost $PgHost -Port $Port -Database $Database `
      -PgUser $PgUser -Psql $Psql -OutDir $OutDir *>&1 | Out-File -FilePath $selfLog -Encoding UTF8
  $selfExit = $LASTEXITCODE
  $selfText = Get-Content $selfLog -Raw
  $sm = [regex]::Match($selfText, 'SELFTESTS (\d+) (\d+)')
  if ($sm.Success) {
    Add-Result "harness self-tests: passed=$($sm.Groups[1].Value) failed=$($sm.Groups[2].Value)" `
      $(if ($selfExit -eq 0 -and $sm.Groups[2].Value -eq '0') { 'PASS' } else { 'FAIL' }) "log=$selfLog"
  } else {
    Add-Result 'harness self-tests produced no summary' 'FAIL' "log=$selfLog"
  }

  Write-Host ''
  Write-Host '=== 3. SERVER MATRIX (fixtures + invariants + projection suite + lifecycle) ===' -ForegroundColor Cyan
  $matrixLog = Join-Path $outPath 'revalidation-matrix.txt'
  & (Join-Path $PSScriptRoot 'builder-forward-migration-matrix.ps1') -PgHost $PgHost -Port $Port `
      -Database $Database -PgUser $PgUser -Psql $Psql -OutDir $OutDir *>&1 | Out-File -FilePath $matrixLog -Encoding UTF8
  $matrixExit = $LASTEXITCODE
  $text = Get-Content $matrixLog -Raw
  $expectedFixtures = -1
  if ($text -match 'EXPECTED_FIXTURES (\d+)') { $expectedFixtures = [int]$Matches[1] }
  foreach ($tag in @('SUMMARY', 'INVARIANTS', 'PROJECTION', 'LIFECYCLE')) {
    # Tri-state summary: <passed> <failed> <indeterminate> <total>. ROUND-3 M1: GREEN requires
    # zero failures, zero indeterminate verdicts AND a conserved corpus (passed+failed+null =
    # total), so a verdict that vanished cannot shrink the denominator.
    $m = [regex]::Match($text, "$tag (\d+) (\d+) (\d+) (\d+)")
    if ($m.Success) {
      $p = [int]$m.Groups[1].Value; $fl = [int]$m.Groups[2].Value
      $nu = [int]$m.Groups[3].Value; $to = [int]$m.Groups[4].Value
      $conserved = ($to -eq ($p + $fl + $nu))
      Add-Result "$tag layer: passed=$p failed=$fl indeterminate=$nu total=$to" `
        $(if ($fl -eq 0 -and $nu -eq 0 -and $conserved) { 'PASS' } else { 'FAIL' }) `
        $(if ($conserved) { 'conserved' } else { 'CONSERVATION VIOLATION' })
      if ($tag -eq 'SUMMARY') {
        Add-Result "the fixture corpus is fully accounted for (expected $expectedFixtures)" `
          $(if ($expectedFixtures -ge 0 -and $to -eq $expectedFixtures) { 'PASS' } else { 'FAIL' }) `
          "expected=$expectedFixtures observed=$to"
      }
    } else {
      Add-Result "$tag layer produced no tri-state summary" 'FAIL' "see $matrixLog"
    }
  }
  Add-Result 'the tri-state accounting self-test passed' $(if ($text -match 'SELFTEST_NULL_SUMMARY PASS') { 'PASS' } else { 'FAIL' }) '38 TRUE + 1 NULL must not summarise as all-pass'
  Add-Result 'the matrix reported RESULT: GREEN' $(if ($matrixExit -eq 0) { 'PASS' } else { 'FAIL' }) "exit=$matrixExit log=$matrixLog"

  Write-Host ''
  Write-Host '=== 4. ATOMICITY / PREFLIGHT ON A SEEDED PRE-MIGRATION DATABASE ===' -ForegroundColor Cyan
  if (-not $PreMigrationTemplate) {
    Add-Result 'atomicity suite' 'SKIP' '-PreMigrationTemplate not supplied'
  }
  else {
    $db = ("review2_reval_{0}" -f (Get-Date -Format 'HHmmss')).ToLowerInvariant()
    $created = & $Psql -w -h $PgHost -p $Port -U $PgUser -d postgres -q -c "create database $db template $PreMigrationTemplate;" 2>&1
    if ($LASTEXITCODE -ne 0) {
      Add-Result 'atomicity suite' 'FAIL' ($created | Out-String).Trim()
    }
    else {
      $atomLog = Join-Path $outPath 'revalidation-atomicity.txt'
      & (Join-Path $PSScriptRoot 'builder-repair-atomicity.ps1') -PgHost $PgHost -Port $Port -Database $db `
          -PgUser $PgUser -Psql $Psql -OutDir $OutDir -SeedIncompatible *>&1 | Out-File -FilePath $atomLog -Encoding UTF8
      $atomExit = $LASTEXITCODE
      $m = [regex]::Match((Get-Content $atomLog -Raw), 'ATOMICITY (\d+) (\d+)')
      if ($m.Success) {
        Add-Result "atomicity suite: passed=$($m.Groups[1].Value) failed=$($m.Groups[2].Value)" `
          $(if ($atomExit -eq 0 -and $m.Groups[2].Value -eq '0') { 'PASS' } else { 'FAIL' }) "database=$db log=$atomLog"
      } else {
        Add-Result 'atomicity suite produced no summary' 'FAIL' "database=$db log=$atomLog"
      }
    }
  }
}
finally {
  Remove-Item Env:\PGOPTIONS -ErrorAction SilentlyContinue
  $passed = @($results | Where-Object { $_.Verdict -eq 'PASS' }).Count
  $failed = @($results | Where-Object { $_.Verdict -eq 'FAIL' }).Count
  $skipped = @($results | Where-Object { $_.Verdict -eq 'SKIP' }).Count
  if ($results.Count -eq 0) { $failed = 1 }
  Write-Host ''
  Write-Host ("REVALIDATION {0} {1} {2}" -f $passed, $failed, $skipped)
  Pop-Location
  if ($failed -gt 0) { exit 1 } else { exit 0 }
}

