param([string]$Path = "tests")
Write-Host ">> pytest $Path..." -ForegroundColor Cyan
pytest $Path -v
