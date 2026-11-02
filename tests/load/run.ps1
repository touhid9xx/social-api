# Run Locust headless against local uvicorn.
#
# Prerequisites:
#   - uvicorn social_api.main:app --reload  (or prod compose stack)
#   - Demo accounts seeded:  python scripts/seed_demo_data.py
#     The profile signs in as the 30 seeded @example.com users and caches one
#     token per account per Locust process. It does not register, because
#     register/login are rate limited to 5/minute per IP and the login gate
#     rejects unverified accounts.
#   - RATE_LIMIT_ENABLED=false for the API under test, or the bootstrap logins
#     spend their budget on 429s and you measure slowapi instead of the app.
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
    [string]$HostUrl = "http://localhost:8000",
    # Adds the registration class. Keep -Users small: register is 5/minute per IP.
    [switch]$RegistrationSpike
)

if ($RegistrationSpike) { $env:LOAD_TEST_REGISTRATION_SPIKE = "1" }

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
