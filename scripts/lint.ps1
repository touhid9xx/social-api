Write-Host ">> ruff check..." -ForegroundColor Cyan
ruff check src tests scripts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ">> ruff format --check..." -ForegroundColor Cyan
ruff format --check src tests scripts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ">> mypy strict..." -ForegroundColor Cyan
mypy src
exit $LASTEXITCODE
