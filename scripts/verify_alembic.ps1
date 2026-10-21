# Verifies Alembic migrations round-trip cleanly:
#   upgrade head -> downgrade base -> upgrade head
# Fails loudly if any step breaks.
# Use in local dev AND CI.
param(
    [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = "Stop"

if (-not $DatabaseUrl) {
    Write-Host "! DATABASE_URL not set; loading from .env" -ForegroundColor Yellow
    if (Test-Path ".env") {
        Get-Content ".env" | ForEach-Object {
            if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
                $name = $matches[1].Trim()
                $value = $matches[2].Trim()
                if ($name -eq "DATABASE_URL") {
                    $DatabaseUrl = $value
                }
            }
        }
    }
}

if (-not $DatabaseUrl) {
    Write-Host "ERROR: DATABASE_URL not set. Cannot verify Alembic." -ForegroundColor Red
    exit 1
}

$env:DATABASE_URL = $DatabaseUrl

Write-Host ">> alembic upgrade head..." -ForegroundColor Cyan
alembic upgrade head
if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: upgrade head" -ForegroundColor Red; exit 1 }

Write-Host ">> alembic downgrade base..." -ForegroundColor Cyan
alembic downgrade base
if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: downgrade base" -ForegroundColor Red; exit 1 }

Write-Host ">> alembic upgrade head (again)..." -ForegroundColor Cyan
alembic upgrade head
if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: re-upgrade head" -ForegroundColor Red; exit 1 }

Write-Host "OK: Alembic round-trip clean (upgrade -> downgrade -> upgrade)." -ForegroundColor Green
