Write-Host ">> cleaning caches..." -ForegroundColor Cyan
Remove-Item -Recurse -Force .pytest_cache, .mypy_cache, .ruff_cache -ErrorAction SilentlyContinue
Get-ChildItem -Recurse -Include __pycache__ -Directory | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
