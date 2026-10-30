# Apply Alembic migrations up to a revision (default: head).
#
# NOTE: this script previously ran `pytest` — a copy-paste of scripts/test.ps1.
# The name says "migrate", so that was a trap for anyone following the README.
param([string]$Revision = "head")

Write-Host ">> alembic upgrade $Revision..." -ForegroundColor Cyan
alembic upgrade $Revision
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: alembic upgrade $Revision" -ForegroundColor Red
    exit 1
}

Write-Host ">> alembic current..." -ForegroundColor Cyan
alembic current
exit $LASTEXITCODE
