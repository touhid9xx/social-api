Write-Host ">> ruff check --fix..." -ForegroundColor Cyan
ruff check --fix src tests scripts

Write-Host ">> ruff format..." -ForegroundColor Cyan
ruff format src tests scripts
