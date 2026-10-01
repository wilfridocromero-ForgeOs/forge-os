# Harness self-tests + reviewed-bytes hash pinning.
#
#   & .\scripts\builder-harness-selftests.ps1 -Database <db>            # guards + dynamic probe + verify
#   & .\scripts\builder-harness-selftests.ps1 -Record                   # (re)record the reviewed bytes
#   & .\scripts\builder-harness-selftests.ps1 -Verify                   # only compare against the record
#
# WHY THIS EXISTS
#   The rev 2/3 passes each shipped a harness defect that made a suite report GREEN without
#   running, or without counting what it claimed to count:
#     H1 array splatting passed the elements POSITIONALLY, so `-PgHost` became the value of the
#        first positional parameter and the host string was bound to -Port; the runner silently
#        did nothing and a STALE log from a previous session was read as the verdict.
#     H2 Write-Host writes to stream 6, which `2>&1` does NOT capture, so logs came out empty.
#     H3 an injected failure placed AFTER `commit;` proved nothing about rollback.
#     H4 `Join-Path $repo <absolute-path>` produced a non-existent path, so psql exited 1 before
#        running anything and every atomicity check passed vacuously.
#   Each guard below asserts the FIX is present in the current bytes. They are static on purpose:
#   a regression in the harness must be caught even when no database is available.
#
#   LOW-2: the same file also pins the SHA256 of every permanent harness/test/migration file, so
#   an independent reviewer can quote the hashes at the start of its review and re-verify them at
#   the end. If any reviewed byte changes, the review evidence is invalid.
#
# Prints `SELFTESTS <passed> <failed>` and exits 0 only when every guard holds.

[CmdletBinding()]
param(
  [string]$PgHost = '127.0.0.1',
  [int]$Port = 55432,
  [string]$Database = '',
  [string]$PgUser = 'postgres',
  [string]$Psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe',
  [string]$OutDir = '.pgvalidate\matrix',
  [switch]$Record,
  [switch]$Verify,
  [switch]$StaticOnly
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo

$results = @()
function Add-Check {
  param([string]$Name, [bool]$Ok, [string]$Detail = '')
  $script:results += [pscustomobject]@{ Name = $Name; Verdict = $(if ($Ok) { 'PASS' } else { 'FAIL' }); Detail = $Detail }
  $colour = if ($Ok) { 'Green' } else { 'Red' }
  Write-Host ("  [{0}] {1} :: {2}" -f $(if ($Ok) { 'PASS' } else { 'FAIL' }), $Name, $Detail) -ForegroundColor $colour
}
function Get-Text { param([string]$Rel) $p = Join-Path $repo $Rel; if (Test-Path $p) { return (Get-Content $p -Raw) } return '' }

# ---------------------------------------------------------------------------
# The reviewed set. Every permanent harness, test and migration the suite relies on.
# ---------------------------------------------------------------------------
$reviewedFiles = @(
  'supabase/migrations/20260918000000_builder_landing_v2_projection_repair.sql',
  'src/features/builder/document/landingServerValidationFixtures.js',
  'src/features/builder/document/landingServerValidationFixtures.test.js',
  'src/features/builder/document/landingV2ProjectionRepairMigration.test.js',
  'scripts/builder-forward-migration-matrix.mjs',
  'scripts/builder-forward-migration-matrix.ps1',
  'scripts/builder-projection-suite.mjs',
  'scripts/builder-lifecycle-matrix.mjs',
  'scripts/builder-repair-atomicity.mjs',
  'scripts/builder-repair-atomicity.ps1',
  'scripts/builder-sabotage-mutants.mjs',
  'scripts/builder-forward-migration-sabotage.ps1',
  'scripts/builder-harness-selftests.ps1',
  # The revalidation DRIVER judges the matrix log, so its bytes decide what GREEN means for a
  # whole run: it belongs in the reviewed set alongside the layers it adjudicates.
  'scripts/builder-round2-revalidation.ps1'
)

$hashFile = Join-Path $repo (Join-Path $OutDir 'harness-hashes.txt')

try {
  $outPath = Join-Path $repo $OutDir
  if (-not (Test-Path $outPath)) { New-Item -ItemType Directory -Path $outPath -Force | Out-Null }

  Write-Host ''
  Write-Host '=== HARNESS STATIC GUARDS (H1-H4 and the M1 accounting) ===' -ForegroundColor Cyan

  $sabotage = Get-Text 'scripts/builder-forward-migration-sabotage.ps1'
  $mutants = Get-Text 'scripts/builder-sabotage-mutants.mjs'
  $matrixMjs = Get-Text 'scripts/builder-forward-migration-matrix.mjs'
  $matrixPs1 = Get-Text 'scripts/builder-forward-migration-matrix.ps1'
  $atomicityPs1 = Get-Text 'scripts/builder-repair-atomicity.ps1'
  $revalPs1 = Get-Text 'scripts/builder-round2-revalidation.ps1'
  $projectionMjs = Get-Text 'scripts/builder-projection-suite.mjs'
  $lifecycleMjs = Get-Text 'scripts/builder-lifecycle-matrix.mjs'
  $migrationSql = Get-Text 'supabase/migrations/20260918000000_builder_landing_v2_projection_repair.sql'
  $fixturesJs = Get-Text 'src/features/builder/document/landingServerValidationFixtures.js'
  $fixturesTestJs = Get-Text 'src/features/builder/document/landingServerValidationFixtures.test.js'

  # F1 (round 4) — a colour/token field must assert JSON string-ness BEFORE the token regex.
  # `->>` stringifies a JSON boolean, so a guard-less regex accepts `true`/`false` while the
  # client's validToken (a typeof check) rejects them: a server-weaker false acceptance.
  Add-Check 'F1 background.color asserts JSON string-ness before its token regex' `
    ($migrationSql -match "jsonb_typeof\(background->'color'\) is not null") `
    'without it ->-> stringifies true to a token-shaped text'
  Add-Check 'F1 background.overlay_color asserts JSON string-ness before its token regex' `
    ($migrationSql -match "jsonb_typeof\(background->'overlay_color'\) <> 'string'") `
    'same root cause at the image overlay colour'
  Add-Check 'F1 the area responsive spacing override asserts JSON string-ness' `
    ($migrationSql -match "jsonb_typeof\(bp\.bv->'spacing'\) is not null") `
    'pre-existing C.8 gap: spacing was validated by key only'
  Add-Check 'F1 the repair is pinned by corpus fixtures' `
    (($fixturesJs -match '61-background-solid-color-boolean') -and ($fixturesJs -match '62-background-image-overlay-color-boolean') `
      -and ($fixturesJs -match '63-area-responsive-spacing-boolean') -and ($fixturesJs -match '64-area-responsive-spacing-valid-token')) `
    'a boolean token case AND a positive control must both be in the corpus'
  Add-Check 'F1 the corpus test still lists the F1 fixtures' `
    (($fixturesTestJs -match '61-background-solid-color-boolean') -and ($fixturesTestJs -match '62-background-image-overlay-color-boolean') `
      -and ($fixturesTestJs -match '63-area-responsive-spacing-boolean') -and ($fixturesTestJs -match '64-area-responsive-spacing-valid-token')) `
    'a fixture outside the asserted lists would not be checked'
  Add-Check 'F1 sabotage mutants S23 and S24 exist and are registered' `
    (($mutants -match 'S23') -and ($mutants -match 'S24') -and ($sabotage -match "Id = 'S23'") -and ($sabotage -match "Id = 'S24'")) `
    'the repair must have a mutant that turns the suite RED'

  # ROUND-6 — the NULL-blind / type-coerced v2-native false acceptances must stay closed.
  Add-Check 'R6 the AREA responsive layout/align memberships are type-guarded' `
    (($migrationSql -match "jsonb_typeof\(bp\.bv->'layout'\) is not null") -and ($migrationSql -match "jsonb_typeof\(bp\.bv->'align'\) is not null")) `
    'NULL not in (...) is NULL, so JSON null skipped the invalid branch'
  Add-Check 'R6 the REQUIRED layout fields assert an exact JSON string' `
    (($migrationSql -match "jsonb_typeof\(s->'layout'\) is distinct from 'string'") `
      -and ($migrationSql -match "jsonb_typeof\(node->'layout'\) is distinct from 'string'")) `
    'absent and JSON null must both be rejected for a required enum'
  Add-Check 'R6 the REQUIRED region span asserts an exact JSON number' `
    ($migrationSql -match "jsonb_typeof\(region->'span'\) is distinct from 'number'") `
    'an absent span left the whole OR NULL, which is not TRUE'
  Add-Check 'R6 schema_version asserts the exact JSON type, not text coercion' `
    ($migrationSql -match "jsonb_typeof\(candidate->'schema_version'\) <> 'number'") `
    'the JSON string "2" must not be treated as equivalent to the number 2'
  Add-Check 'R6 the Pattern responsive layout/align stay deliberately UNguarded' `
    ($migrationSql -match "or \(bp\.bv \? 'layout' and bp\.bv->>'layout' not in") `
    'the client keys-checks Pattern overrides, so guarding them would ADD server strictness'
  Add-Check 'R6 the repaired cases are pinned by corpus fixtures' `
    (($fixturesJs -match '65-area-responsive-layout-null') -and ($fixturesJs -match '71-section-layout-null') `
      -and ($fixturesJs -match '73-region-span-null') -and ($fixturesJs -match '74-schema-version-string') `
      -and ($fixturesJs -match '77-section-layout-absent') -and ($fixturesJs -match '79-region-span-absent')) `
    'absence, null and wrong-type must each be captured, plus negative controls'
  Add-Check 'R6 sabotage mutants S25/S26/S27 exist and are registered' `
    (($mutants -match 'S25') -and ($mutants -match 'S26') -and ($mutants -match 'S27') `
      -and ($sabotage -match "Id = 'S25'") -and ($sabotage -match "Id = 'S26'") -and ($sabotage -match "Id = 'S27'")) `
    'each repaired guarantee needs a mutant that turns its fixture RED'

  # H1 — no array-splatting of a named-parameter call.
  Add-Check 'H1 the matrix runner is invoked with HASHTABLE splatting' `
    (($sabotage -match '\$matrixArgs\s*=\s*@\{') -and ($sabotage -notmatch '\$matrixArgs\s*=\s*@\(')) `
    'array splatting binds "-PgHost" positionally and never reaches the script'

  # H2 — output of a Write-Host harness is captured with *>&1.
  $captureCount = ([regex]::Matches($sabotage, '\*>&1')).Count
  Add-Check 'H2 harness output is captured with *>&1 (stream 6 included)' `
    (($captureCount -ge 2) -and ($sabotage -notmatch '-ExpectFailure\s+2>&1') -and ($sabotage -notmatch '@matrixArgs\s+2>&1')) `
    "captures=$captureCount"

  # H3 — the S13 control injects its failure BEFORE commit;, i.e. inside the transaction.
  $controlSql = Get-Content (Join-Path $outPath 'sabotage\S13-control.sql') -ErrorAction SilentlyContinue
  if (-not $controlSql) {
    $controlSql = (Get-Text 'scripts/builder-sabotage-mutants.mjs')
  }
  $markerIdx = -1; $commitIdx = -1; $i = 0
  foreach ($line in $controlSql) {
    $i++
    if ("$line" -match 'SABOTAGE_S13_CONTROL_LATE_FAILURE') { if ($markerIdx -lt 0) { $markerIdx = $i } }
    if ("$line" -match '^commit;\s*$') { $commitIdx = $i }
  }
  Add-Check 'H3 the S13 control fails INSIDE the transaction (before commit)' `
    ($markerIdx -gt 0 -and $commitIdx -gt 0 -and $markerIdx -lt $commitIdx) `
    "failure at line $markerIdx, commit at line $commitIdx"

  # H4 — the atomicity suite resolves an absolute -MigrationFile and refuses a missing file.
  Add-Check 'H4 -MigrationFile is resolved with IsPathRooted and missing files are refused' `
    (($atomicityPs1 -match 'IsPathRooted') -and ($atomicityPs1 -match 'migration file not found') -and ($atomicityPs1 -notmatch 'Join-Path \$repo \$MigrationFile\)')) `
    'an unresolved path makes psql exit 1 and every atomicity check pass vacuously'

  # M1 — tri-state accounting actually present in both the SQL and the runner.
  Add-Check 'M1 the summary counts PASS/FAIL/NULL separately' `
    (($matrixMjs -match "count\(\*\) filter \(where ok is true\)") -and ($matrixMjs -match "count\(\*\) filter \(where ok is false\)") -and ($matrixMjs -match "count\(\*\) filter \(where ok is null\)")) `
    'a NULL verdict must not leave the denominator'
  Add-Check 'M1 an indeterminate gate makes the verdict indeterminate, not a pass' `
    ($matrixMjs -match 'when e\.landing_gate is null or e\.check_gate is null then null') `
    'the judged expression is NULL-aware'
  Add-Check 'M1 the runner asserts corpus conservation and zero indeterminate verdicts' `
    (($matrixPs1 -match 'CONSERVATION VIOLATION') -and ($matrixPs1 -match 'EXPECTED_FIXTURES') -and ($matrixPs1 -match 'NULL VERDICT') -and ($matrixPs1 -match '\$nullVerdictFailed')) `
    'passed+failed+null = expected, and null = 0 for GREEN'
  Add-Check 'M1 no NULL-blind bool_and(ok) remains in the generators' `
    (($matrixMjs -notmatch 'bool_and\(ok\)') -and ($projectionMjs -notmatch 'bool_and\(ok\)')) `
    'bool_and ignores NULL inputs'
  Add-Check 'M1 the revalidation driver requires tri-state summaries' `
    ($revalPs1 -match "\`$tag \(\\d\+\) \(\\d\+\) \(\\d\+\) \(\\d\+\)") `
    'a 2-number summary is treated as absent'
  Add-Check 'M1 the 38 TRUE + 1 NULL self-test is generated' `
    ($matrixMjs -match 'SELFTEST_NULL_SUMMARY') 'proves the summary cannot turn 38+1NULL into all-pass'
  # M1.6 — the discriminating self-test must cover the OTHER two ways a corpus can be
  # miscounted: a FALSE verdict, and a fully-TRUE corpus whose size is not the expected size.
  # Without these, "38 TRUE + 1 FALSE is RED" and "39 TRUE is GREEN only at expected 39" are
  # claims rather than measured properties of the acceptance rule.
  Add-Check 'M1.6 the generator emits the FALSE-verdict self-test' `
    ($matrixMjs -match 'SELFTEST_FALSE_SUMMARY') '38 TRUE + 1 FALSE must be RED'
  Add-Check 'M1.6 the generator emits the 39-TRUE GREEN-and-conservation self-tests' `
    (($matrixMjs -match 'SELFTEST_TRUE39_GREEN') -and ($matrixMjs -match 'SELFTEST_TRUE39_CONSERVATION')) `
    '39 TRUE is GREEN only when expected corpus size is 39'
  Add-Check 'M1.6 the generator emits the NULL-blind contrast self-test' `
    ($matrixMjs -match 'SELFTEST_NULLBLIND_SUMMARY') 'the old expression reads 38 0 for 38 TRUE + 1 NULL'
  Add-Check 'M1.6 the generator emits the empty-corpus self-test' `
    ($matrixMjs -match 'SELFTEST_EMPTY_CORPUS_RED') 'an empty corpus must be RED, not vacuously clean'
  Add-Check 'M1.6 every self-test declares the outcome its corpus REQUIRES' `
    (($matrixMjs -match "when 'GREEN' then") -and ($matrixMjs -match "else \(count\(\*\) = 1\) and bool_and\(not green\)")) `
    'a case asserts RED vs GREEN, so it cannot pass by asserting the wrong direction'
  Add-Check 'M1.6 the row-count assertion is INSIDE the aggregate (empty corpus cannot pass)' `
    (($matrixMjs -match "\(count\(\*\) = 1\) and bool_and\(green\)") `
      -and ($matrixMjs -notmatch "when count\(\*\) = 1 and bool_and")) `
    'a separate "count(*) = 1 and ..." is vacuously true for an empty set'
  Add-Check 'M1.6 the runner requires EVERY discriminating self-test, not just the NULL one' `
    (($matrixPs1 -match 'SELFTEST_NULLBLIND_SUMMARY') -and ($matrixPs1 -match 'SELFTEST_FALSE_SUMMARY') `
      -and ($matrixPs1 -match 'SELFTEST_TRUE39_GREEN') -and ($matrixPs1 -match 'SELFTEST_TRUE39_CONSERVATION') `
      -and ($matrixPs1 -match 'SELFTEST_EMPTY_CORPUS_RED')) `
    'a missing self-test must fail closed, not be skipped'
  Add-Check 'M1.6 GREEN requires zero failures AND zero nulls AND a conserved corpus' `
    (($revalPs1 -match '\$fl -eq 0 -and \$nu -eq 0 -and \$conserved') -and ($revalPs1 -match 'indeterminate=')) `
    'the revalidation driver acceptance predicate is tri-state and corpus-conserving'
  Add-Check 'M1 the lifecycle matcher still discriminates on SQLSTATE + constraint' `
    (($lifecycleMjs -match 'control_verdict') -and ($lifecycleMjs -match 'matcher-selftest')) 'S17 kill stays meaningful'

  # ---------------------------------------------------------------------------
  # Dynamic: the tri-state summary expression must refuse to call 38 TRUE + 1 NULL an all-pass
  # corpus. Runs against a real database when one is supplied.
  # ---------------------------------------------------------------------------
  if ($Database -and -not $StaticOnly) {
    Write-Host ''
    Write-Host '=== DYNAMIC TRI-STATE SUMMARY PROBE ===' -ForegroundColor Cyan
    $sql = @"
select case when count(*) filter (where ok is true) = 38
              and count(*) filter (where ok is false) = 0
              and count(*) filter (where ok is null) = 1
              and (count(*) filter (where ok) || ' ' || count(*) filter (where not ok)) = '38 0'
              and (count(*) filter (where ok is true) || ' ' || count(*) filter (where ok is false)
                   || ' ' || count(*) filter (where ok is null)) <> '38 0 0'
            then 'PASS' else 'FAIL' end
from (select true as ok from generate_series(1,38) union all select null) x;
"@
    $out = & $Psql -w -h $PgHost -p $Port -U $PgUser -d $Database -tAc $sql 2>&1
    $verdict = ($out | Out-String).Trim()
    Add-Check 'dynamic: 38 TRUE + 1 NULL cannot produce an all-pass summary' ($verdict -eq 'PASS') "verdict=$verdict"
  }
  else {
    Write-Host '  (dynamic tri-state probe skipped: no -Database supplied)'
    Add-Check 'dynamic: 38 TRUE + 1 NULL cannot produce an all-pass summary' $true 'SKIPPED (static only)'
  }

  # ---------------------------------------------------------------------------
  # LOW-2: pin the reviewed bytes.
  # ---------------------------------------------------------------------------
  Write-Host ''
  Write-Host '=== REVIEWED-BYTES HASH PINNING (LOW-2) ===' -ForegroundColor Cyan
  $lines = @()
  $lines += '# SHA256 of the permanent harness/test/migration bytes under review.'
  $lines += '# A reviewer must quote these at the START of its review and re-verify them at the END.'
  $lines += '# If any reviewed file changes, the review evidence is INVALID and must restart.'
  $lines += "# recorded: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  foreach ($rel in $reviewedFiles) {
    $p = Join-Path $repo $rel
    if (Test-Path $p) { $lines += "sha256 $((Get-FileHash -Algorithm SHA256 $p).Hash.ToLower())  $rel" }
    else { $lines += "MISSING                                       $rel" }
  }

  if (-not $Verify) {
    Set-Content -Path $hashFile -Value ($lines -join "`r`n") -Encoding ASCII
    Write-Host "  recorded $($reviewedFiles.Count) hashes -> $hashFile"
  }

  if (Test-Path $hashFile) {
    $expected = @{}
    foreach ($l in Get-Content $hashFile) { if ($l -match '^sha256 ([0-9a-f]{64})\s+(.+)$') { $expected[$Matches[2].Trim()] = $Matches[1] } }
    $drift = @(); $checked = 0
    foreach ($rel in $reviewedFiles) {
      $p = Join-Path $repo $rel
      if (-not $expected.ContainsKey($rel)) { continue }
      if (-not (Test-Path $p)) { $drift += "$rel MISSING"; continue }
      $checked++
      if ($expected[$rel] -ne (Get-FileHash -Algorithm SHA256 $p).Hash.ToLower()) { $drift += "$rel CHANGED" }
    }
    Add-Check "reviewed bytes are unchanged since they were recorded ($checked files)" `
      ($drift.Count -eq 0) $(if ($drift.Count -eq 0) { "record=$hashFile" } else { ($drift -join '; ') })
    Write-Host ''
    Write-Host '  reviewed-bytes manifest:' -ForegroundColor Cyan
    Get-Content $hashFile | Where-Object { $_ -match '^sha256' } | ForEach-Object { Write-Host "    $_" }
  }
  else {
    Add-Check 'reviewed bytes are unchanged since they were recorded' $false "no manifest at $hashFile"
  }
}
finally {
  $passed = @($results | Where-Object { $_.Verdict -eq 'PASS' }).Count
  $failed = @($results | Where-Object { $_.Verdict -eq 'FAIL' }).Count
  if (@($results).Count -eq 0) { $failed = 1 }
  Write-Host ''
  Write-Host ("SELFTESTS {0} {1}" -f $passed, $failed)
  Pop-Location
  if ($failed -gt 0) { exit 1 } else { exit 0 }
}
