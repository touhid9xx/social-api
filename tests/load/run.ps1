# Run Locust headless against local uvicorn.
#
# Prerequisites:
#   - uvicorn social_api.main:app --reload  (or prod compose stack)
#   - Fresh DB recommended (docker compose down -v && up -d)
#   - .\venv\Scripts\Activate.ps1
#
# Output:
#   tests/load/run_stats.csv        (raw request stats)
#   tests/load/run_stats_history.csv
#   tests/load/run_failures.csv
#   tests/load/report.html          (open in browser)

param(
    [int]$Users = 5000,
    [int]$SpawnRate = 50,
    [string]$RunTime = "3m",
    [string]$HostUrl = "http://localhost:8000"
)

Write-Host ">> Locust: users=$Users spawn-rate=$SpawnRate duration=$RunTime host=$HostUrl" -ForegroundColor Cyan

locust -f tests/load/locustfile.py `
    --host=$HostUrl `
    --headless `
    --users $Users `
    --spawn-rate $SpawnRate `
    --run-time $RunTime `
    --csv=tests/load/run `
    --html=tests/load/report.html `
    --only-summary

Write-Host ""
Write-Host "Done. Open tests/load/report.html" -ForegroundColor Green
