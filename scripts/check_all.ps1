# Mirror of CI. Run this before `git push`.
# Order matters: format -> lint -> type -> security -> contract export -> tests -> contract drift -> alembic
#
# NOTE: save this file as UTF-8 with BOM (Windows PowerShell 5.1 defaults to
# CP1252 without a BOM and mangles UTF-8 chars like em-dash, arrows, checkmarks).
param(
    [switch]$SkipAlembic,
    [switch]$Fast
)

$ErrorActionPreference = "Stop"
$failures = @()

function Step {
    param([string]$Name, [scriptblock]$Block)
    Write-Host ""
    Write-Host ">> $Name" -ForegroundColor Cyan
    try {
        & $Block
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
            throw "exit code $LASTEXITCODE"
        }
    } catch {
        Write-Host "FAILED: $Name - $_" -ForegroundColor Red
        $script:failures += $Name
    }
}

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

Step "ruff format --check" { ruff format --check src tests scripts }
Step "ruff check"          { ruff check src tests scripts }
Step "mypy (strict)"       { mypy src tests }
Step "bandit"              { bandit -r src -c pyproject.toml -q }

# Contract export runs BEFORE pytest so the drift test sees a fresh snapshot.
Step "contract export"     { python scripts/export_api_contract.py }

Step "pytest + coverage"   {
    if ($Fast) {
        pytest tests/unit -q --cov=src/social_api --cov-report=term-missing
    } else {
        # Integration tests are gated on TEST_DB_URL being set. If not
        # set, only unit tests run (CI sets TEST_DB_URL explicitly).
        if ($env:TEST_DB_URL) {
            pytest tests/unit tests/integration --cov=src/social_api --cov-report=term-missing --cov-report=xml
        } else {
            Write-Host "  (TEST_DB_URL not set - skipping integration tests)" -ForegroundColor DarkYellow
            pytest tests/unit --cov=src/social_api --cov-report=term-missing --cov-report=xml
        }
    }
}
Step "contract drift"      { python scripts/check_api_contract_drift.py }

if (-not $SkipAlembic) {
    # Point alembic at the test DB so dev `social` data (from manual smoke
    # tests / uvicorn sessions) doesn't clash with the round-trip wipe.
    Step "alembic round-trip" {
        $savedDbUrl = $env:DATABASE_URL
        try {
            if ($env:TEST_DB_URL) {
                $env:DATABASE_URL = $env:TEST_DB_URL
                Write-Host "  (alembic round-trip against TEST_DB_URL)" -ForegroundColor DarkGray
            } else {
                Write-Host "  (alembic round-trip against DATABASE_URL)" -ForegroundColor DarkGray
            }
            powershell -ExecutionPolicy Bypass -File scripts/verify_alembic.ps1
        } finally {
            if ($savedDbUrl) { $env:DATABASE_URL = $savedDbUrl }
        }
    }
}

$stopwatch.Stop()
Write-Host ""
Write-Host ("Elapsed: {0:N1}s" -f $stopwatch.Elapsed.TotalSeconds) -ForegroundColor Cyan

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "FAILURES:" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

Write-Host ""
Write-Host "ALL CHECKS PASSED" -ForegroundColor Green
exit 0
