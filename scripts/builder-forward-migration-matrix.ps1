# Builder landing persistence - permanent server-validation matrix.
#
# Runs the fixture corpus in src/features/builder/document/landingServerValidationFixtures.js
# against a real PostgreSQL and reports PASS/FAIL per fixture. This is the only place where a
# SERVER verdict is measured; the node test suite checks the client half.
#
# The target database MUST have the full migration chain applied. `-Database` is required in
# practice because the default name is a convention, not a guarantee:
#
#   & .\scripts\builder-forward-migration-matrix.ps1 -Database orvesen_validate
#
# Build one from scratch with the sanctioned helper (takes a few minutes):
#   & .\scripts\validate-baseline-local.ps1 -Database <name>
#
# Exit codes: 0 = every fixture matched AND the invariants and lifecycle were clean.
#             1 = at least one mismatch. 2 = the SQL never produced a summary.
# The invariants and lifecycle layers only run when the forward migration is present, so the
# same script also serves as the RED-before baseline against a C.8-only database.

[CmdletBinding()]
param(
  [string]$PgHost = '127.0.0.1',
  [int]$Port = 55432,
  [string]$Database = 'orvesen_validate',
  [string]$PgUser = 'postgres',
  [string]$Psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe',
  [string]$OutDir = '.pgvalidate\matrix',
  # SABOTAGE ONLY (mutant S17): regenerate the lifecycle with a matcher that accepts any
  # exception as a successful negative control. The lifecycle's own matcher self-test must then
  # turn the run RED. Never used in a normal run.
  [switch]$LoosenLifecycleMatcher
)

# psql writes NOTICEs to stderr, which PowerShell 5.1 turns into a terminating error under
# 'Stop'. Progress is judged from the summary lines and explicit checks instead.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo

# Reads the "<TAG> <passed> <failed> [<indeterminate> <total>]" summary line a SQL file prints.
# Returns Found = $false (and Failed = -1) when the summary is absent, so a broken run can never
# look green. ROUND-3 M1: the indeterminate and total fields are REQUIRED for the acceptance
# layer — a summary that omits them is treated as absent rather than as a pass.
function Read-Summary {
  param([object[]]$Lines, [string]$Tag, [switch]$RequireTriState)
  $line = $null
  foreach ($candidate in $Lines) { if ("$candidate" -match "$Tag\s+\d+\s+\d+") { $line = "$candidate" } }
  if (-not $line) {
    return [pscustomobject]@{ Found = $false; Passed = 0; Failed = -1; Nulls = -1; Total = -1; Raw = '' }
  }
  if ($line -match "$Tag\s+(\d+)\s+(\d+)(?:\s+(\d+))?(?:\s+(\d+))?") {
    $nulls = if ($Matches[3] -ne '') { [int]$Matches[3] } else { -1 }
    $total = if ($Matches[4] -ne '') { [int]$Matches[4] } else { -1 }
    if ($RequireTriState -and ($nulls -lt 0 -or $total -lt 0)) {
      return [pscustomobject]@{ Found = $false; Passed = 0; Failed = -1; Nulls = -1; Total = -1; Raw = $line }
    }
    return [pscustomobject]@{
      Found = $true; Passed = [int]$Matches[1]; Failed = [int]$Matches[2]
      Nulls = $nulls; Total = $total; Raw = $line
    }
  }
  return [pscustomobject]@{ Found = $false; Passed = 0; Failed = -1; Nulls = -1; Total = -1; Raw = $line }
}

# Kept for the layers whose failure count is all that matters, but it now fails closed on NULL
# too: an indeterminate verdict in that layer counts as a failure.
function Read-SummaryCount {
  param([object[]]$Lines, [string]$Tag)
  $summary = Read-Summary -Lines $Lines -Tag $Tag
  if (-not $summary.Found) { return -1 }
  if ($summary.Nulls -gt 0) { return ($summary.Failed + $summary.Nulls) }
  return $summary.Failed
}

try {
  $outPath = Join-Path $repo $OutDir
  if (-not (Test-Path $outPath)) { New-Item -ItemType Directory -Path $outPath -Force | Out-Null }

  Write-Host 'generating fixtures...' -ForegroundColor Cyan
  & node 'scripts/builder-forward-migration-matrix.mjs' $outPath
  if ($LASTEXITCODE -ne 0) { throw 'fixture generation failed' }
  & node 'scripts/builder-projection-suite.mjs' $outPath
  if ($LASTEXITCODE -ne 0) { throw 'projection-suite generation failed' }

  $env:PGOPTIONS = '-c statement_timeout=60000 -c lock_timeout=5000 -c max_parallel_workers_per_gather=0'
  $connection = @('-w', '-h', $PgHost, '-p', $Port, '-U', $PgUser, '-d', $Database)

  Write-Host ''
  Write-Host '=== SERVER VERDICT MATRIX ===' -ForegroundColor Cyan
  $verdicts = & $Psql @connection -f (Join-Path $outPath 'matrix-verdicts.sql') 2>&1
  foreach ($line in $verdicts) { Write-Host $line }

  # ROUND-3 M1: the expected corpus size comes from the FIXTURE SOURCE (the generator stamps it
  # into the SQL), never from the database result count alone. A verdict that vanished could
  # otherwise shrink the denominator and be reported as a clean run.
  $expectedFixtures = -1
  $verdictSqlText = Get-Content (Join-Path $outPath 'matrix-verdicts.sql') -Raw
  if ($verdictSqlText -match 'EXPECTED_FIXTURES\s+(\d+)') { $expectedFixtures = [int]$Matches[1] }

  $verdictSummary = Read-Summary -Lines $verdicts -Tag 'SUMMARY' -RequireTriState
  if (-not $verdictSummary.Found) { Write-Host 'RESULT: NO TRI-STATE SUMMARY - SQL did not complete' -ForegroundColor Red; exit 2 }

  $passed = $verdictSummary.Passed
  $failedFixtures = $verdictSummary.Failed

  # --- corpus conservation + tri-state accounting (M1 items 2, 3, 8) -----------------------
  $observedTotal = $verdictSummary.Total
  $conservationFailed = 0
  $nullVerdictFailed = 0
  if ($expectedFixtures -lt 0) {
    Write-Host 'CONSERVATION VIOLATION: the fixture source did not declare EXPECTED_FIXTURES' -ForegroundColor Red
    $conservationFailed = 1
  }
  elseif ($observedTotal -ne $expectedFixtures) {
    Write-Host ("CONSERVATION VIOLATION: summary accounts for {0} of {1} fixtures" -f $observedTotal, $expectedFixtures) -ForegroundColor Red
    $conservationFailed = 1
  }
  if ($verdictSummary.Nulls -ne 0) {
    Write-Host ("NULL VERDICT(S): {0} fixture gate(s) returned SQL NULL - an indeterminate verdict is a NULL-as-success hazard, not a pass" -f $verdictSummary.Nulls) -ForegroundColor Red
    $nullVerdictFailed = 1
  }
  # The self-tests prove the summary expression itself cannot turn a corpus containing a
  # non-TRUE verdict into an all-pass corpus, and that a fully-true corpus is only GREEN when
  # its size equals the expected corpus size (ROUND-3 M1 item 7 / M1.6). If any is missing or
  # FAIL, the accounting above cannot be trusted.
  $selfTestTags = @(
    'SELFTEST_NULL_SUMMARY',           # 38 TRUE + 1 NULL -> RED
    'SELFTEST_NULLBLIND_SUMMARY',      # the old NULL-blind expression reads '38 0' for that corpus
    'SELFTEST_FALSE_SUMMARY',          # 38 TRUE + 1 FALSE -> RED
    'SELFTEST_TRUE39_GREEN',           # 39 TRUE at expected 39 -> GREEN
    'SELFTEST_TRUE39_CONSERVATION',    # 39 TRUE at expected 38 -> RED (conservation)
    'SELFTEST_EMPTY_CORPUS_RED'        # an empty corpus must be RED, not vacuously clean
  )
  $selfTestFailed = 0
  foreach ($tag in $selfTestTags) {
    $tagLine = $null
    foreach ($line in $verdicts) { if ("$line" -match "$tag\s+(PASS|FAIL)") { $tagLine = "$line" } }
    if (-not $tagLine -or $tagLine -notmatch "$tag\s+PASS") {
      Write-Host "NULL-SUMMARY SELF-TEST FAILED ($tag) - the accounting cannot be trusted" -ForegroundColor Red
      $selfTestFailed = 1
    }
    else {
      Write-Host "  tri-state accounting self-test: $($tagLine.Trim())"
    }
  }

  Write-Host ''
  Write-Host 'checking whether the repair is fully applied...'
  # The probe is the LIVE CONSTRAINT, not the existence of the helper functions. A database can
  # hold the repaired functions while still carrying C.8's dispatcher-only CHECK - for example
  # when a migration run was interrupted between the two - and in that state the CHECK is what
  # decides behaviour. Probing the function alone would run the lifecycle against a schema that
  # cannot support it.
  $probeSql = @"
select (to_regprocedure('private.builder_landing_document_v2_projection(jsonb)') is not null
        and to_regprocedure('private.builder_document_is_valid(jsonb)') is not null)::text
       || '|' ||
       coalesce((select (pg_get_constraintdef(oid)
                         like '%private.builder_document_is_valid(document)%')::text
                 from pg_constraint where conname = 'builder_asset_drafts_document_check'), 'false');
"@
  $probe = & $Psql @connection -tAc $probeSql
  # `boolean::text` renders 'true'/'false'; psql's own display would render 't'/'f'.
  $probeText = ($probe | Out-String).Trim().ToLowerInvariant()
  $probeParts = $probeText -split '\|'
  $hasProjection = ($probeParts[0] -eq 'true')
  $checkDispatches = ($probeParts.Count -gt 1 -and $probeParts[1] -eq 'true')

  $failed = $failedFixtures
  $invariantFailed = 0
  $projectionFailed = 0
  $lifecycleFailed = 0
  $contractFailed = 0

  # Two separate facts, deliberately NOT conflated. If the repaired functions exist but the
  # CHECK does not dispatch on document type, that is a CONTRACT VIOLATION and is reported RED.
  # Skipping the lifecycle layer in that state would let a mutant that restores C.8's
  # dispatcher-only CHECK pass unnoticed.
  if ($hasProjection -and -not $checkDispatches) {
    $contractFailed = 1
    Write-Host 'CONTRACT VIOLATION: the drafts CHECK does not dispatch on document type' -ForegroundColor Red
  }
  if (-not $hasProjection) {
    Write-Host '  repair not applied: the invariants and projection layers will be skipped' -ForegroundColor Yellow
  }

  if ($hasProjection) {
    Write-Host ''
    Write-Host '=== PROJECTION INVARIANTS (I1-I7) ===' -ForegroundColor Cyan
    $invariants = & $Psql @connection -f (Join-Path $outPath 'matrix-invariants.sql') 2>&1
    foreach ($line in $invariants) { Write-Host $line }
    $invariantSummary = Read-Summary -Lines $invariants -Tag 'INVARIANTS' -RequireTriState
    if ($invariantSummary.Found) {
      $invariantFailed = $invariantSummary.Failed
      if ($invariantSummary.Nulls -ne 0) {
        Write-Host "PROJECTION INVARIANT NULLS: $($invariantSummary.Nulls) indeterminate check(s)" -ForegroundColor Red
        $invariantFailed += $invariantSummary.Nulls
      }
    }
    else { $invariantFailed = -1 }

    # Round-2 F1: termination, NULL-safety, the hard bound and the salt step/increment. This
    # layer is what turns the S11/S12 mutants RED; the verdict layer cannot see them, because a
    # NULL-poisoned search is unreachable from the validator once the dedicated ids are validated
    # natively, and the bound only shows up on a document that plants many candidates.
    Write-Host ''
    Write-Host '=== PROJECTION / SYNTHETIC-ID SUITE (R1) ===' -ForegroundColor Cyan
    $projectionSuite = & $Psql @connection -f (Join-Path $outPath 'matrix-projection.sql') 2>&1
    foreach ($line in $projectionSuite) { Write-Host $line }
    $projectionSummary = Read-Summary -Lines $projectionSuite -Tag 'PROJECTION' -RequireTriState
    if ($projectionSummary.Found) {
      $projectionFailed = $projectionSummary.Failed
      if ($projectionSummary.Nulls -ne 0) {
        Write-Host "PROJECTION NULL VERDICTS: $($projectionSummary.Nulls) indeterminate assertion(s)" -ForegroundColor Red
        $projectionFailed += $projectionSummary.Nulls
      }
    }
    else { $projectionFailed = -1 }
  }
  else {
    Write-Host 'forward migration NOT present - invariants and projection suite skipped (RED-before run)' -ForegroundColor Yellow
  }

  # The lifecycle only runs when the CHECK dispatches; otherwise it is reported through
  # $contractFailed above and skipped, so it can never hang on a non-dispatching schema.
  if ($hasProjection -and $checkDispatches) {
    Write-Host ''
    Write-Host '=== LIFECYCLE: save -> read-back -> publish -> public read, Form creation, negatives ===' -ForegroundColor Cyan
    $lifecycleArgs = @('scripts/builder-lifecycle-matrix.mjs', $outPath)
    if ($LoosenLifecycleMatcher) { $lifecycleArgs += '--loosen-matcher'; Write-Host '  SABOTAGE S17: lifecycle negative-control matcher loosened' -ForegroundColor Yellow }
    & node @lifecycleArgs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'lifecycle generation failed' }
    $lifecycle = & $Psql @connection -f (Join-Path $outPath 'matrix-lifecycle.sql') 2>&1
    foreach ($line in $lifecycle) { Write-Host $line }
    $lifecycleSummary = Read-Summary -Lines $lifecycle -Tag 'LIFECYCLE' -RequireTriState
    if ($lifecycleSummary.Found) {
      $lifecycleFailed = $lifecycleSummary.Failed
      if ($lifecycleSummary.Nulls -ne 0) {
        Write-Host "LIFECYCLE NULL VERDICTS: $($lifecycleSummary.Nulls) indeterminate step(s)" -ForegroundColor Red
        $lifecycleFailed += $lifecycleSummary.Nulls
      }
    }
    else { $lifecycleFailed = -1 }
  }

  $total = $failed + $invariantFailed + $lifecycleFailed + $contractFailed + $projectionFailed + $conservationFailed + $nullVerdictFailed + $selfTestFailed
  Write-Host ''
  if ($total -eq 0) {
    Write-Host "RESULT: GREEN - $passed/$expectedFixtures fixtures matched (0 indeterminate), invariants, projection suite and lifecycle clean" -ForegroundColor Green
    exit 0
  }
  Write-Host "RESULT: RED - fixtures=$failed invariants=$invariantFailed projection=$projectionFailed lifecycle=$lifecycleFailed conservation=$conservationFailed null_verdicts=$nullVerdictFailed null_summary_selftest=$selfTestFailed" -ForegroundColor Red
  exit 1
}
finally {
  Remove-Item Env:\PGOPTIONS -ErrorAction SilentlyContinue
  Pop-Location
}
