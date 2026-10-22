# Mirror of CI. Run this before `git push`.
# Order matters: format -> lint -> type -> security -> contract export -> tests -> contract drift -> alembic
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
# If this step changes files, either commit them or the drift test will pass
# (because drift test compares app -> contract; both are fresh).
Step "contract export"     { python scripts/export_api_contract.py }

Step "pytest + coverage"   {
    # Coverage threshold lives in pyproject.toml (fail_under=60 at M0, raise at M2).
    if ($Fast) {
        pytest tests/unit -q --cov=src/social_api --cov-report=term-missing
    } else {
        pytest tests/unit --cov=src/social_api --cov-report=term-missing --cov-report=xml
    }
}
Step "contract drift"      { python scripts/check_api_contract_drift.py }

if (-not $SkipAlembic) {
    Step "alembic round-trip" { powershell -ExecutionPolicy Bypass -File scripts/verify_alembic.ps1 }
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
