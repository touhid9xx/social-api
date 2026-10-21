# Mirror of CI. Run this before `git push`.
# Order matters: format -> lint -> type -> security -> tests -> contracts -> alembic
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
Step "pytest + coverage"   {
    # NOTE: coverage threshold lives in pyproject.toml (fail_under=60 at M0,
    # raise to 85 at M2). Do NOT pass --cov-fail-under here - it would
    # override the pyproject setting.
    if ($Fast) {
        pytest tests/unit -q --cov=src/social_api --cov-report=term-missing
    } else {
        pytest tests/unit --cov=src/social_api --cov-report=term-missing --cov-report=xml
    }
}
Step "contract export"     { python scripts/export_api_contract.py }
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
