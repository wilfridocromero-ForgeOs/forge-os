# S1-S17 sabotage / mutation run for the forward migration.
#
# For every mutant: apply it, prove the matrix (or the atomicity suite, or the lifecycle
# harness) turns RED, restore the correct implementation, and prove it returns GREEN. A mutant
# that cannot turn its layer RED is reported as an INEFFECTIVE MUTANT rather than counted as a
# successful kill. Malformed mutants are refused at generation time
# (scripts/builder-sabotage-mutants.mjs throws when a mutation does not apply).
#
#   & .\scripts\builder-forward-migration-sabotage.ps1 -Database orvesen_mx `
#       -PreMigrationTemplate <a database at the C.8 state>
#
# Three mutant kinds, because three different layers have to be exercised:
#   migration        a schema mutant: apply the file, matrix RED, re-apply the migration, GREEN
#   atomicity        a whole-file mutant (S13) and its control: the atomicity suite decides,
#                    each run getting a FRESH database built from -PreMigrationTemplate
#   lifecycle        a HARNESS mutant (S17): the lifecycle is regenerated with a loosened
#                    negative-control matcher, and its own matcher self-test must go RED
#
# -PreMigrationTemplate is required for the atomicity kind only.

[CmdletBinding()]
param(
  [string]$PgHost = '127.0.0.1',
  [int]$Port = 55432,
  [string]$Database = 'orvesen_mx',
  [string]$PgUser = 'postgres',
  [string]$Psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe',
  [string]$OutDir = '.pgvalidate\matrix',
  [string]$PreMigrationTemplate = ''
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo

$matrix = Join-Path $PSScriptRoot 'builder-forward-migration-matrix.ps1'
$atomicity = Join-Path $PSScriptRoot 'builder-repair-atomicity.ps1'
$migration = 'supabase/migrations/20260918000000_builder_landing_v2_projection_repair.sql'
$mutantDir = Join-Path (Join-Path $repo $OutDir) 'sabotage'

$env:PGOPTIONS = '-c statement_timeout=60000 -c lock_timeout=5000 -c max_parallel_workers_per_gather=0'
$connection = @('-w', '-h', $PgHost, '-p', $Port, '-U', $PgUser, '-d', $Database)

function Invoke-SqlFile {
  param([string]$Path)
  $out = & $Psql @connection -q -v ON_ERROR_STOP=1 -f $Path 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "SQL FAILED: $Path" -ForegroundColor Red
    foreach ($line in $out) { Write-Host "    $line" }
    throw "sql failed: $Path"
  }
}

function Invoke-Matrix {
  param([string]$Tag, [switch]$LoosenMatcher)
  $log = Join-Path (Join-Path $repo $OutDir) "sabotage-$Tag.txt"
  # A stale log must never be read back as this run's verdict: that is exactly how a previous
  # session's "GREEN 24/24" could be reported for a run that never happened. Delete first, and
  # treat a missing RESULT line as a HARNESS ERROR rather than a pass.
  if (Test-Path $log) { Remove-Item $log -Force }
  # HASHTABLE splatting, deliberately: array splatting passes the elements as POSITIONAL
  # arguments, so "-PgHost" becomes the value of the first positional parameter and the host
  # string is bound to -Port. That bug made the runner silently do nothing and read a STALE log
  # from a previous session as this run's verdict.
  $matrixArgs = @{
    PgHost = $PgHost; Port = $Port; Database = $Database; PgUser = $PgUser
    Psql = $Psql; OutDir = $OutDir
  }
  if ($LoosenMatcher) { $matrixArgs['LoosenLifecycleMatcher'] = $true }
  # Captured into a variable with ALL streams redirected: the runner reports through
  # Write-Host, which is stream 6 and is NOT collected by `2>&1`.
  $captured = & $matrix @matrixArgs *>&1
  $code = $LASTEXITCODE
  $text = ($captured | Out-String)
  Set-Content -Path $log -Value $text -Encoding UTF8
  $resultLine = ($text -split "`r?`n" | Where-Object { $_ -match '^RESULT: ' } | Select-Object -Last 1)
  if (-not "$resultLine") {
    return [pscustomobject]@{
      Exit = 99
      Result = "HARNESS ERROR: the matrix log has no RESULT line (log=$log bytes=$($text.Length))"
      Log = $log
    }
  }
  return [pscustomobject]@{ Exit = $code; Result = "$resultLine"; Log = $log }
}

# Restores the correct implementation. The old `S7-restore.sql` is deliberately gone: it restored
# C.8's publish, which would silently reinstate the NULL-permissive publication guard. Re-applying
# the migration is the only correct restore.
function Restore-CorrectImplementation {
  Invoke-SqlFile (Join-Path $repo $migration)
}

# A FRESH database at the pre-migration state, so an atomicity mutant can never contaminate the
# next scenario. DROP DATABASE is unavailable in this environment, so names are unique.
function New-PreMigrationDatabase {
  param([string]$Label)
  if (-not $PreMigrationTemplate) { return $null }
  $name = ("review2_atomic_{0}_{1}" -f ($Label -replace '[^a-z0-9]', ''), (Get-Date -Format 'HHmmss'))
  $name = $name.ToLowerInvariant()
  $out = & $Psql -w -h $PgHost -p $Port -U $PgUser -d postgres -q -c "create database $name template $PreMigrationTemplate;" 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Host ($out | Out-String); throw "could not create $name from template $PreMigrationTemplate" }
  return $name
}

function Invoke-Atomicity {
  param([string]$DatabaseName, [string]$MigrationPath)
  $log = Join-Path (Join-Path $repo $OutDir) "sabotage-atomicity-$([System.IO.Path]::GetFileNameWithoutExtension($MigrationPath)).txt"
  if (Test-Path $log) { Remove-Item $log -Force }
  # ALL streams: the atomicity suite reports through Write-Host (stream 6).
  $captured = & $atomicity -PgHost $PgHost -Port $Port -Database $DatabaseName -PgUser $PgUser -Psql $Psql `
      -OutDir $OutDir -MigrationFile $MigrationPath -ExpectFailure *>&1
  $code = $LASTEXITCODE
  $text = ($captured | Out-String)
  Set-Content -Path $log -Value $text -Encoding UTF8
  $line = ($text -split "`r?`n" | Where-Object { $_ -match '^ATOMICITY\s+(\d+)\s+(\d+)' } | Select-Object -Last 1)
  if (-not "$line") { return [pscustomobject]@{ Exit = 99; Result = "HARNESS ERROR: no ATOMICITY summary (log=$log bytes=$($text.Length))"; Log = $log } }
  return [pscustomobject]@{ Exit = $code; Result = "$line"; Log = $log }
}

Write-Host 'generating mutants...' -ForegroundColor Cyan
& node 'scripts/builder-sabotage-mutants.mjs' $mutantDir | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'mutant generation failed' }

$mutants = @(
  @{ Id = 'S1'; Title = 'restore stack + multiple projected Regions'; Kind = 'migration' },
  @{ Id = 'S2'; Title = 'reuse the wrapped Block id as the synthetic Region id'; Kind = 'migration' },
  @{ Id = 'S3'; Title = 'reuse the Section id for an empty-composition Region'; Kind = 'migration' },
  @{ Id = 'S4'; Title = 'lose the first Pattern Region and its Blocks'; Kind = 'migration' },
  @{ Id = 'S5'; Title = 'reorder composition during projection'; Kind = 'migration' },
  @{ Id = 'S6'; Title = 'random salt in the synthetic id search'; Kind = 'migration' },
  @{ Id = 'S7'; Title = 'publish uses the v1-only validator'; Kind = 'migration' },
  @{ Id = 'S8'; Title = 'dispatcher-only drafts CHECK'; Kind = 'migration' },
  @{ Id = 'S9'; Title = 'remove the dedicated-surface style exemption'; Kind = 'migration' },
  @{ Id = 'S10'; Title = 'stop validating Pattern node style VALUES'; Kind = 'migration' },
  @{ Id = 'S11'; Title = 'reintroduce the NULL-sensitive salt exit'; Kind = 'migration' },
  @{ Id = 'S12'; Title = 'remove the hard bound on the salted search'; Kind = 'migration' },
  @{ Id = 'S13'; Title = 'strip the transaction and fail late'; Kind = 'atomicity' },
  @{ Id = 'S13-control'; Title = 'the same late failure WITH the transaction'; Kind = 'atomicity-control' },
  @{ Id = 'S14'; Title = 'allow an invalid Pattern background string'; Kind = 'migration' },
  @{ Id = 'S15'; Title = 'allow an invalid Pattern solid background colour'; Kind = 'migration' },
  @{ Id = 'S16'; Title = 'restore NULL publication-metadata acceptance'; Kind = 'migration' },
  @{ Id = 'S17'; Title = 'loosen the lifecycle negative-control matcher'; Kind = 'lifecycle' },
  # ROUND-3
  @{ Id = 'S18'; Title = 'make an authoritative verdict indeterminate (SQL NULL)'; Kind = 'migration' },
  @{ Id = 'S19'; Title = 'permit an illegal key for none/transparent/solid'; Kind = 'migration' },
  @{ Id = 'S20'; Title = 'bypass overlay_color validation'; Kind = 'migration' },
  @{ Id = 'S21'; Title = 'bypass overlay_opacity validation and range'; Kind = 'migration' },
  @{ Id = 'S22'; Title = 'weaken the per-image/gradient key restriction'; Kind = 'migration' },
  # ROUND-4 F1
  @{ Id = 'S23'; Title = 'drop the JSON-string guard on background.color/overlay_color'; Kind = 'migration' },
  @{ Id = 'S24'; Title = 'drop the JSON-string guard on the area responsive spacing override'; Kind = 'migration' },
  # ROUND-6
  @{ Id = 'S25'; Title = 'drop the null-safety guard on area responsive layout/align'; Kind = 'migration' },
  @{ Id = 'S26'; Title = 'drop the required-string/presence guards on layout and region span'; Kind = 'migration' },
  @{ Id = 'S27'; Title = 'drop the exact-JSON-type guard on top-level schema_version'; Kind = 'migration' }
)

Write-Host ''
Write-Host '=== baseline: the correct implementation must be GREEN before any sabotage ===' -ForegroundColor Cyan
$baseline = Invoke-Matrix 'baseline'
Write-Host "  $($baseline.Result)"
if ($baseline.Exit -ne 0) {
  Write-Host 'ABORT: the suite is not green before sabotage, so a RED result would prove nothing.' -ForegroundColor Red
  exit 2
}

$results = @()
foreach ($m in $mutants) {
  Write-Host ''
  Write-Host "=== $($m.Id): $($m.Title) [$($m.Kind)] ===" -ForegroundColor Cyan

  if ($m.Kind -eq 'atomicity' -or $m.Kind -eq 'atomicity-control') {
    if (-not $PreMigrationTemplate) {
      Write-Host '  SKIPPED: -PreMigrationTemplate was not supplied' -ForegroundColor Yellow
      $results += [pscustomobject]@{ Id = $m.Id; Kind = $m.Kind; Verdict = 'SKIPPED (no template)'; Detail = '-' }
      continue
    }
    $db = New-PreMigrationDatabase -Label $m.Id
    $run = Invoke-Atomicity -DatabaseName $db -MigrationPath (Join-Path $mutantDir "$($m.Id).sql")
    Write-Host "  atomicity suite on ${db}: $($run.Result)"
    # S13 must DETECT the missing transaction (exit != 0); its control must stay atomic (exit 0).
    $killed = if ($m.Kind -eq 'atomicity') { $run.Exit -ne 0 } else { $run.Exit -eq 0 }
    $results += [pscustomobject]@{
      Id = $m.Id; Kind = $m.Kind
      Verdict = $(if ($run.Exit -eq 99) { 'HARNESS ERROR' }
                  elseif ($m.Kind -eq 'atomicity') { if ($killed) { 'KILLED (atomicity suite detected the half-applied schema)' } else { 'INEFFECTIVE MUTANT' } }
                  else { if ($killed) { 'CONTROL OK (atomicity held with the transaction intact)' } else { 'CONTROL FAILED' } })
      Detail = $run.Result
    }
    continue
  }

  if ($m.Kind -eq 'lifecycle') {
    $red = Invoke-Matrix "$($m.Id)-red" -LoosenMatcher
    Write-Host "  after mutation: $($red.Result)"
    $green = Invoke-Matrix "$($m.Id)-green"
    Write-Host "  after restore : $($green.Result)"
    $killed = ($red.Exit -ne 0) -and ($red.Exit -ne 99) -and ($green.Exit -eq 0)
    $results += [pscustomobject]@{
      Id = $m.Id; Kind = $m.Kind
      Verdict = $(if ($red.Exit -eq 99 -or $green.Exit -eq 99) { 'HARNESS ERROR' }
                  elseif ($killed) { 'KILLED (RED -> restore -> GREEN)' }
                  else { 'INEFFECTIVE MUTANT' })
      Detail = "$($red.Result) || $($green.Result)"
    }
    continue
  }

  Invoke-SqlFile (Join-Path $mutantDir "$($m.Id).sql")
  $red = Invoke-Matrix "$($m.Id)-red"
  Write-Host "  after mutation: $($red.Result)"

  Restore-CorrectImplementation
  $green = Invoke-Matrix "$($m.Id)-green"
  Write-Host "  after restore : $($green.Result)"

  $killed = ($red.Exit -ne 0) -and ($red.Exit -ne 99) -and ($green.Exit -eq 0)
  $results += [pscustomobject]@{
    Id = $m.Id; Kind = $m.Kind
    Verdict = $(if ($red.Exit -eq 99 -or $green.Exit -eq 99) { 'HARNESS ERROR' }
                elseif ($killed) { 'KILLED (RED -> restore -> GREEN)' }
                else { 'INEFFECTIVE MUTANT' })
    Detail = "$($red.Result) || $($green.Result)"
  }
}

Write-Host ''
Write-Host '=== SABOTAGE SUMMARY ===' -ForegroundColor Cyan
$results | Format-Table Id, Kind, Verdict -AutoSize | Out-Host

$killedCount = ($results | Where-Object { $_.Verdict -like 'KILLED*' }).Count
$ineffective = $results | Where-Object { $_.Verdict -eq 'INEFFECTIVE MUTANT' }
$errored = $results | Where-Object { $_.Verdict -eq 'HARNESS ERROR' }
$skipped = $results | Where-Object { $_.Verdict -like 'SKIPPED*' }
Write-Host "killed: $killedCount of $(($results | Where-Object { $_.Verdict -notlike 'SKIPPED*' }).Count) (skipped: $($skipped.Count), harness errors: $($errored.Count))"
if ($ineffective -or $errored) {
  if ($ineffective) { Write-Host "INEFFECTIVE: $(($ineffective | Select-Object -ExpandProperty Id) -join ', ')" -ForegroundColor Red }
  if ($errored) { Write-Host "HARNESS ERROR: $(($errored | Select-Object -ExpandProperty Id) -join ', ')" -ForegroundColor Red }
  exit 1
}
if ($skipped) {
  Write-Host "SKIPPED: $(($skipped | Select-Object -ExpandProperty Id) -join ', ')" -ForegroundColor Yellow
  exit 3
}

Write-Host 'ALL SABOTAGE MUTANTS KILLED' -ForegroundColor Green
Remove-Item Env:\PGOPTIONS -ErrorAction SilentlyContinue
Pop-Location
exit 0

