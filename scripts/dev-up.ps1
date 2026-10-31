Write-Host ">> Starting Docker services..." -ForegroundColor Cyan
docker compose up -d

Write-Host ">> Waiting for MySQL to be healthy..." -ForegroundColor Cyan
$maxAttempts = 30
for ($i = 0; $i -lt $maxAttempts; $i++) {
    $status = docker inspect --format='{{.State.Health.Status}}' social-mysql 2>$null
    if ($status -eq "healthy") {
        Write-Host "   MySQL is healthy." -ForegroundColor Green
        break
    }
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "Services:" -ForegroundColor Cyan
Write-Host "  MySQL      : 127.0.0.1:3307"
Write-Host "  Redis      : 127.0.0.1:6379"
Write-Host "  Jaeger UI  : http://localhost:16686"
Write-Host "  Prometheus : http://localhost:9090"
Write-Host "  Grafana    : http://localhost:3030 (admin/admin)"
Write-Host "  Frontend   : http://localhost:3000 (cd frontend; pnpm dev)"
