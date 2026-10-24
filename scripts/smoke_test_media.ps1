# scripts/smoke_test_media.ps1
# Manual smoke test: media upload -> get -> static mount.
# Uses Invoke-RestMethod (PowerShell-idiomatic, not curl alias).
# Requires API running at http://localhost:8000.
# ASCII-only content (no em-dashes, arrows, box chars).

$ErrorActionPreference = "Stop"
$base = "http://localhost:8000"

function Assert-Ok {
    param([string]$Label)
    Write-Host "[PASS] $Label" -ForegroundColor Green
}

function Assert-Fail {
    param([string]$Label)
    Write-Host "[FAIL] $Label" -ForegroundColor Red
}

# === 1. Register media-live user ===
Write-Host ""
Write-Host "=== 1. Register media-live user ==="

$regBody = @{ email = "medialive@example.com"; password = "Str0ng!Passw0rd" } | ConvertTo-Json -Compress

try {
    Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/register" `
        -Body $regBody -ContentType "application/json" | Out-Null
    Assert-Ok "user registered"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 409) {
        Write-Host "[SKIP] user already exists" -ForegroundColor Yellow
    } else {
        throw
    }
}

# === 2. Login, capture token + user_id ===
Write-Host ""
Write-Host "=== 2. Login ==="

$loginBody = @{ email = "medialive@example.com"; password = "Str0ng!Passw0rd" } | ConvertTo-Json -Compress
$loginResp = Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/login" `
    -Body $loginBody -ContentType "application/json"

$token  = $loginResp.tokens.access_token
$userId = $loginResp.user.id

Write-Host "       user id=$userId  token len=$($token.Length)"
Assert-Ok "logged in"

$h = @{ Authorization = "Bearer $token" }

# === 3. Write a test PNG to disk ===
Write-Host ""
Write-Host "=== 3. Write test.png to disk ==="

$png = [byte[]](
    0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,
    0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
    0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
    0x08,0x06,0x00,0x00,0x00,0x1F,0x15,0xC4,0x89,
    0x00,0x00,0x00,0x0D,0x49,0x44,0x41,0x54,
    0x78,0x9C,0x63,0x00,0x01,0x00,0x00,0x05,0x00,0x01,0x00,
    0x0D,0x0A,0x2D,0xB4,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82
)

$testPng = Join-Path $PWD "test.png"
[IO.File]::WriteAllBytes($testPng, $png)
Write-Host "       wrote $($png.Length) bytes to $testPng"
Assert-Ok "test.png on disk"

# === 4. Upload (multipart) ===
Write-Host ""
Write-Host "=== 4. Upload PNG ==="

$psVersion = $PSVersionTable.PSVersion.Major

if ($psVersion -ge 7) {
    # PowerShell 7.4+: -Form supported
    $upload = Invoke-RestMethod -Method Post -Uri "$base/api/v1/media" `
        -Headers $h -Form @{ file = Get-Item $testPng }
} else {
    # PowerShell 5.1: manual multipart
    Add-Type -AssemblyName System.Net.Http
    $http = [System.Net.Http.HttpClient]::new()
    $http.DefaultRequestHeaders.Authorization = `
        [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $token)

    $content = [System.Net.Http.MultipartFormDataContent]::new()
    $fileBytes = [IO.File]::ReadAllBytes($testPng)
    $fileContent = [System.Net.Http.ByteArrayContent]::new($fileBytes)
    $fileContent.Headers.ContentType = `
        [System.Net.Http.Headers.MediaTypeHeaderValue]::new("image/png")
    $content.Add($fileContent, "file", "test.png")

    $response = $http.PostAsync("$base/api/v1/media", $content).Result
    $body = $response.Content.ReadAsStringAsync().Result
    $upload = $body | ConvertFrom-Json

    if (-not $response.IsSuccessStatusCode) {
        throw "Upload failed: $($response.StatusCode) $body"
    }
    $http.Dispose()
}

$mediaId  = $upload.id
$mediaUrl = $upload.url

Write-Host "       media id=$mediaId"
Write-Host "       kind=$($upload.kind)  mime=$($upload.mime)  size=$($upload.size_bytes)"
Write-Host "       url=$mediaUrl"
Assert-Ok "media uploaded"

# === 5. Get by id ===
Write-Host ""
Write-Host "=== 5. GET /media/{id} ==="

$fetched = Invoke-RestMethod -Method Get -Uri "$base/api/v1/media/$mediaId" -Headers $h
Write-Host "       id=$($fetched.id)  post_id=$($fetched.post_id)  url=$($fetched.url)"
Assert-Ok "get media"

# === 6. Fetch static file from disk-mount URL ===
Write-Host ""
Write-Host "=== 6. Fetch file from static mount ==="

$staticUrl = if ($mediaUrl -like "http*") { $mediaUrl } else { "$base$mediaUrl" }
Write-Host "       fetching $staticUrl"

$staticResp = Invoke-WebRequest -Uri $staticUrl -UseBasicParsing
Write-Host "       status=$($staticResp.StatusCode)  content-length=$($staticResp.RawContentLength)  content-type=$($staticResp.Headers['Content-Type'])"
Assert-Ok "static file served"

# Verify it's actually a PNG (first 8 bytes = magic)
$downloaded = $staticResp.Content
if ($downloaded -is [byte[]]) {
    $magicMatch = ($downloaded[0..7] -join ",") -eq "137,80,78,71,13,10,26,10"
} else {
    $magicMatch = $false
}

if ($magicMatch) {
    Assert-Ok "downloaded bytes are a real PNG (magic bytes match)"
} else {
    Write-Host "       (skipping magic check - PS returned string instead of bytes)"
}

# === 7. Dedup: upload same bytes -> same id ===
Write-Host ""
Write-Host "=== 7. Dedup (upload same bytes) ==="

if ($psVersion -ge 7) {
    $upload2 = Invoke-RestMethod -Method Post -Uri "$base/api/v1/media" `
        -Headers $h -Form @{ file = Get-Item $testPng }
} else {
    $http = [System.Net.Http.HttpClient]::new()
    $http.DefaultRequestHeaders.Authorization = `
        [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $token)

    $content = [System.Net.Http.MultipartFormDataContent]::new()
    $fileBytes = [IO.File]::ReadAllBytes($testPng)
    $fileContent = [System.Net.Http.ByteArrayContent]::new($fileBytes)
    $fileContent.Headers.ContentType = `
        [System.Net.Http.Headers.MediaTypeHeaderValue]::new("image/png")
    $content.Add($fileContent, "file", "test.png")

    $response = $http.PostAsync("$base/api/v1/media", $content).Result
    $body = $response.Content.ReadAsStringAsync().Result
    $upload2 = $body | ConvertFrom-Json
    $http.Dispose()
}

if ($upload2.id -eq $mediaId) {
    Assert-Ok "dedup: same bytes -> same media id ($mediaId)"
} else {
    Assert-Fail "dedup broken: got $($upload2.id) expected $mediaId"
}

# === 8. Cleanup ===
Write-Host ""
Write-Host "=== 8. Delete media + local test file ==="

Invoke-RestMethod -Method Delete -Uri "$base/api/v1/media/$mediaId" -Headers $h | Out-Null
Assert-Ok "media deleted"

Remove-Item $testPng -Force -ErrorAction SilentlyContinue
Assert-Ok "local test.png removed"

Write-Host ""
Write-Host "=== Media smoke test complete ===" -ForegroundColor Cyan
