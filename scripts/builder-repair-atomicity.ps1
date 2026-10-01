# Forward-migration ATOMICITY / PREFLIGHT suite (round-2 finding F2).
#
# Proves, on a real database, that:
#   * a database holding a draft that C.8 accepts and this migration rejects ABORTS the
#     migration through the preflight, with no schema change at all (fingerprint identical);
#   * removing that one draft lets the SAME migration apply and commit atomically;
#   * re-applying it is idempotent (fingerprint stable);
#   * an intentionally late failure also rolls back to the pre-migration fingerprint
#     (this is what kills the S13 "no transaction" mutant).
#
#   & .\scripts\builder-repair-atomicity.ps1 -Database <name> -SeedIncompatible
#   & .\scripts\builder-repair-atomicity.ps1 -Database <name> -MigrationFile <mutant.sql> -ExpectFailure
#
# The target database MUST be at the pre-migration (C.8) state when the suite starts.
# Exit codes: 0 = every check passed, 1 = at least one check failed, 2 = the suite could not run.

[CmdletBinding()]
param(
  [string]$PgHost = '127.0.0.1',
  [int]$Port = 55432,
  [Parameter(Mandatory = $true)][string]$Database,
  [string]$PgUser = 'postgres',
  [string]$Psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe',
  [string]$OutDir = '.pgvalidate\matrix',
  [string]$MigrationFile = 'supabase/migrations/20260918000000_builder_landing_v2_projection_repair.sql',
  # Seed the C.8-accepted / repair-invalid draft first, then require the migration to abort.
  [switch]$SeedIncompatible,
  # The migration under test is expected to fail even WITHOUT incompatible rows (S13 mutant).
  [switch]$ExpectFailure
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo

$env:PGOPTIONS = '-c max_parallel_workers_per_gather=0'
$connection = @('-w', '-h', $PgHost, '-p', $Port, '-U', $PgUser, '-d', $Database)
$results = @()

function Add-Result {
  param([string]$Name, [bool]$Ok, [string]$Detail)
  $script:results += [pscustomobject]@{ Name = $Name; Verdict = $(if ($Ok) { 'PASS' } else { 'FAIL' }); Detail = $Detail }
  $colour = if ($Ok) { 'Green' } else { 'Red' }
  Write-Host ("  [{0}] {1} :: {2}" -f $(if ($Ok) { 'PASS' } else { 'FAIL' }), $Name, $Detail) -ForegroundColor $colour
}

function Invoke-File {
  param([string]$Path, [switch]$Stop)
  $cmd = @($connection) + @('-q')
  if ($Stop) { $cmd += @('-v', 'ON_ERROR_STOP=1') }
  $cmd += @('-f', $Path)
  $out = & $Psql @cmd 2>&1
  return [pscustomobject]@{ Exit = $LASTEXITCODE; Text = (($out | Out-String)) }
}

# A caller may pass an absolute path (the sabotage runner does). `Join-Path $repo <absolute>`
# concatenates into a path that does not exist, which makes psql fail with exit 1 BEFORE running
# anything - every atomicity check then passes vacuously. Resolve once, and refuse to run if the
# file is missing.
$migrationPath = if ([System.IO.Path]::IsPathRooted($MigrationFile)) { $MigrationFile } else { Join-Path $repo $MigrationFile }

function Get-Fingerprint {
  $out = & $Psql @connection -tA -f (Join-Path $repo (Join-Path $OutDir 'atomicity-fingerprint.sql')) 2>&1
  # psql prints NOTICEs and pset chatter on the same stream; the fingerprint is the last
  # non-empty line that looks like a 32-hex md5.
  $lines = @($out | ForEach-Object { "$_".Trim() } | Where-Object { $_ -match '^[0-9a-f]{32}$' })
  if ($lines.Count -eq 0) { return '(no-fingerprint)' }
  return $lines[$lines.Count - 1]
}

try {
  $outPath = Join-Path $repo $OutDir
  if (-not (Test-Path $outPath)) { New-Item -ItemType Directory -Path $outPath -Force | Out-Null }
  & node 'scripts/builder-repair-atomicity.mjs' $OutDir | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'atomicity SQL generation failed' }

  Write-Host ''
  Write-Host "=== ATOMICITY SUITE on $Database (migration: $MigrationFile) ===" -ForegroundColor Cyan

  if (-not (Test-Path $migrationPath)) { throw "migration file not found: $migrationPath" }
  $p0 = Get-Fingerprint
  # A fingerprint that could not be computed must never be compared against another
  # uncomputable one: two '(no-fingerprint)' values are equal, which would report "the schema
  # was left exactly as it was" for a run that changed everything. Fail closed instead.
  if ($p0 -eq '(no-fingerprint)') { throw 'could not compute the pre-migration schema fingerprint' }
  Write-Host "  pre-migration fingerprint: $p0"

  if ($SeedIncompatible) {
    $seed = Invoke-File (Join-Path $outPath 'atomicity-seed.sql') -Stop
    if ($seed.Exit -ne 0) { Write-Host $seed.Text; throw 'seeding failed' }
    # Re-read: the fingerprint is schema-only, so seeding must not have moved it. If it did,
    # the suite would be comparing the wrong things.
    $p0AfterSeed = Get-Fingerprint
    if ($p0AfterSeed -ne $p0) { throw "seeding changed the schema fingerprint ($p0 -> $p0AfterSeed)" }
  }

  # ---- run 1: the migration under test -------------------------------------------------
  $run1 = Invoke-File $migrationPath -Stop
  $p1 = Get-Fingerprint
  $expectFailure1 = $SeedIncompatible -or $ExpectFailure

  if ($expectFailure1) {
    Add-Result 'run 1 exits non-zero' ($run1.Exit -ne 0) "exit=$($run1.Exit)"
    if ($SeedIncompatible) {
      Add-Result 'run 1 aborts through the PREFLIGHT' ($run1.Text -match 'BUILDER_REPAIR_PREFLIGHT_INCOMPATIBLE_ROWS') `
        $(if ($run1.Text -match 'BUILDER_REPAIR_PREFLIGHT_INCOMPATIBLE_ROWS') { 'preflight message found' } else { 'preflight message MISSING' })
      Add-Result 'run 1 names the offending rows' ($run1.Text -match 'atomicity incompatible|asset_id=') 'offending row detail'
    }
    Add-Result 'run 1 leaves the schema EXACTLY at the pre-migration state' ($p1 -eq $p0) "before=$p0 after=$p1"
    Add-Result 'run 1 adds no document CHECK dispatching on the repaired validator' `
      (-not ((& $Psql @connection -tAc "select coalesce((select (pg_get_constraintdef(oid) like '%builder_document_is_valid(document)%')::text from pg_constraint where conname='builder_asset_drafts_document_check'),'false')") -match 'true')) `
      'C.8 predicate still live'
    Add-Result 'run 1 leaves no repair function behind' `
      ((& $Psql @connection -tAc "select (to_regprocedure('private.builder_document_is_valid(jsonb)') is null)::text") -match 'true') `
      'builder_document_is_valid absent'
  }
  else {
    Add-Result 'run 1 exits zero' ($run1.Exit -eq 0) "exit=$($run1.Exit)"
    if ($run1.Exit -ne 0) { Write-Host $run1.Text }
    Add-Result 'run 1 changed the schema' ($p1 -ne $p0) "before=$p0 after=$p1"
    $checkOk = (& $Psql @connection -tAc "select coalesce((select (pg_get_constraintdef(oid) like '%builder_document_is_valid(document)%')::text from pg_constraint where conname='builder_asset_drafts_document_check'),'false')")
    Add-Result 'the drafts CHECK dispatches on the repaired validator' ($checkOk -match 'true') "probe=$($checkOk | Out-String)"
    $rows = (& $Psql @connection -tAc "select count(*) from public.builder_asset_drafts") | Out-String
    Add-Result 'existing drafts survived the migration' ([int]$rows.Trim() -ge 1) "drafts=$($rows.Trim())"
  }

  # ---- cleanup + the complementary run --------------------------------------------------
  if ($SeedIncompatible) {
    $cleanup = Invoke-File (Join-Path $outPath 'atomicity-cleanup.sql') -Stop
    if ($cleanup.Exit -ne 0) { Write-Host $cleanup.Text; throw 'cleanup failed' }
    $p2 = Get-Fingerprint
    Add-Result 'removing the one offending draft touches no schema object' ($p2 -eq $p0) "fingerprint=$p2"

    $run2 = Invoke-File $migrationPath -Stop
    $p3 = Get-Fingerprint
    Add-Result 'run 2 now succeeds' ($run2.Exit -eq 0) "exit=$($run2.Exit)"
    Add-Result 'run 2 commits the whole repair' ($p3 -ne $p0) "after=$p3"
    $checkOk2 = (& $Psql @connection -tAc "select coalesce((select (pg_get_constraintdef(oid) like '%builder_document_is_valid(document)%')::text from pg_constraint where conname='builder_asset_drafts_document_check'),'false')")
    Add-Result 'run 2 leaves a dispatching CHECK' ($checkOk2 -match 'true') "probe=$($checkOk2 | Out-String)"
    $bad = (& $Psql @connection -tAc "select count(*) from public.builder_asset_drafts where document->'sections'->0->'composition'->0->'style'->>'align' = 'middle'") | Out-String
    Add-Result 'the offending draft was removed, not rewritten' ([int]$bad.Trim() -eq 0) "remaining=$($bad.Trim())"

    $run3 = Invoke-File $migrationPath -Stop
    $p4 = Get-Fingerprint
    Add-Result 'run 3 (re-apply) is idempotent' (($run3.Exit -eq 0) -and ($p4 -eq $p3)) "exit=$($run3.Exit) fingerprint=$p4"
  }
}
catch {
  # An abort mid-suite is a FAILURE, never a green with a smaller denominator.
  Add-Result 'suite ran to completion' $false "aborted: $($_.Exception.Message)"
}
finally {
  Remove-Item Env:\PGOPTIONS -ErrorAction SilentlyContinue
  $passed = @($results | Where-Object { $_.Verdict -eq 'PASS' }).Count
  $failed = @($results | Where-Object { $_.Verdict -eq 'FAIL' }).Count
  # A suite that never got to run a single check must NEVER look green: an exception during
  # setup (seeding, fingerprinting, SQL generation) leaves zero results, and "0 failures"
  # would be a false pass.
  if (@($results).Count -eq 0) {
    Write-Host ("ATOMICITY {0} {1}" -f 0, 1)
    Write-Host 'ATOMICITY SUITE DID NOT RUN - treating as failure' -ForegroundColor Red
    Pop-Location
    exit 2
  }
  Write-Host ''
  # Explicit -f formatting: a bare "$passed $failed" produced a double space whenever a count
  # came back empty, which broke the caller's summary parser.
  Write-Host ("ATOMICITY {0} {1}" -f $passed, $failed)
  Pop-Location
  if ($failed -gt 0) { exit 1 } else { exit 0 }
}



