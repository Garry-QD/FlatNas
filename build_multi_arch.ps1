$ErrorActionPreference = "Continue"

$IMAGE_NAME = "qdnas/flatnas"
$TAG = "1.0.18"
$env:HTTP_PROXY = "http://192.168.100.3:16888"
$env:HTTPS_PROXY = "http://192.168.100.3:16888"

function Run-With-Retry {
    param (
        [string]$Command,
        [int]$MaxRetries = 5,
        [int]$DelaySeconds = 5
    )
    
    $retryCount = 0
    while ($retryCount -lt $MaxRetries) {
        Write-Host "Executing: $Command (Attempt $($retryCount + 1)/$MaxRetries)"
        Invoke-Expression $Command
        
        if ($LASTEXITCODE -eq 0) {
            return $true
        }
        
        $retryCount++
        Write-Warning "Command failed with exit code $LASTEXITCODE. Retrying in $DelaySeconds seconds..."
        Start-Sleep -Seconds $DelaySeconds
    }
    
    Write-Error "Command failed after $MaxRetries attempts: $Command"
    return $false
}

Write-Host "Ensuring default context..."
try { docker context use default } catch {}

# --- AMD64 ---
Write-Host "Building for linux/amd64..."
docker build --pull --provenance=false --platform linux/amd64 --build-arg HTTP_PROXY=http://192.168.100.3:16888 --build-arg HTTPS_PROXY=http://192.168.100.3:16888 -t "${IMAGE_NAME}:${TAG}-amd64" .
if ($LASTEXITCODE -ne 0) { Write-Error "AMD64 Build failed"; exit 1 }

if (-not (Run-With-Retry -Command "docker push '${IMAGE_NAME}:${TAG}-amd64'")) {
    exit 1
}

# --- ARM64 ---
Write-Host "Building for linux/arm64..."
docker build --pull --provenance=false --platform linux/arm64 --build-arg HTTP_PROXY=http://192.168.100.3:16888 --build-arg HTTPS_PROXY=http://192.168.100.3:16888 -t "${IMAGE_NAME}:${TAG}-arm64" .
if ($LASTEXITCODE -ne 0) { Write-Error "ARM64 Build failed"; exit 1 }

if (-not (Run-With-Retry -Command "docker push '${IMAGE_NAME}:${TAG}-arm64'")) {
    exit 1
}

# --- Manifest for TAG ---
Write-Host "Creating manifest list for ${TAG}..."
docker manifest rm "${IMAGE_NAME}:${TAG}" 2>$null

if (-not (Run-With-Retry -Command "docker manifest create '${IMAGE_NAME}:${TAG}' --amend '${IMAGE_NAME}:${TAG}-amd64' '${IMAGE_NAME}:${TAG}-arm64'")) {
    exit 1
}

if (-not (Run-With-Retry -Command "docker manifest push '${IMAGE_NAME}:${TAG}'")) {
    exit 1
}

# --- Manifest for Latest ---
Write-Host "Creating manifest list for latest..."
docker manifest rm "${IMAGE_NAME}:latest" 2>$null

if (-not (Run-With-Retry -Command "docker manifest create '${IMAGE_NAME}:latest' --amend '${IMAGE_NAME}:${TAG}-amd64' '${IMAGE_NAME}:${TAG}-arm64'")) {
    exit 1
}

if (-not (Run-With-Retry -Command "docker manifest push '${IMAGE_NAME}:latest'")) {
    exit 1
}

Write-Host "Done!"
