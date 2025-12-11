$ErrorActionPreference = "Stop"
# 禁用 BuildKit 以规避 buildx 缺失问题
$env:DOCKER_BUILDKIT=0
$env:DOCKER_CLI_EXPERIMENTAL="enabled"

$PROXY = "http://192.168.100.3:16888"
$env:HTTP_PROXY=$PROXY
$env:HTTPS_PROXY=$PROXY

$IMAGE_NAME = "qdnas/flatnas"
$VERSION = "1.0.26BC"
$ORIGINAL_DOCKERFILE = "Dockerfile"

function Retry-Command {
    param (
        [ScriptBlock]$Command,
        [int]$Retries = 5,
        [int]$Delay = 5
    )
    $attempt = 0
    while ($attempt -lt $Retries) {
        try {
            & $Command
            if ($LASTEXITCODE -ne 0) { throw "Exit code $LASTEXITCODE" }
            return
        }
        catch {
            $attempt++
            Write-Host "Command failed, retrying ($attempt/$Retries)... Error: $_"
            Start-Sleep -Seconds $Delay
        }
    }
    throw "Command failed after $Retries attempts."
}

Write-Host "Starting build for $IMAGE_NAME version $VERSION with proxy $PROXY"

# 读取原始 Dockerfile
$content = Get-Content $ORIGINAL_DOCKERFILE -Raw

# ---------------------------------------------------------
# 1. Build AMD64
# ---------------------------------------------------------
Write-Host "Preparing Dockerfile.amd64..."
$dockerfile_amd64 = $content.Replace('--platform=$BUILDPLATFORM', '--platform=linux/amd64').Replace('--platform=$TARGETPLATFORM', '--platform=linux/amd64')
Set-Content -Path "Dockerfile.amd64" -Value $dockerfile_amd64

Write-Host "Building AMD64..."
# 使用 --no-cache 避免潜在的缓存问题
Retry-Command { docker build --no-cache -f Dockerfile.amd64 --build-arg HTTP_PROXY=$PROXY --build-arg HTTPS_PROXY=$PROXY -t "${IMAGE_NAME}:${VERSION}-amd64" . }

Write-Host "Pushing AMD64..."
Retry-Command { docker push "${IMAGE_NAME}:${VERSION}-amd64" }

# ---------------------------------------------------------
# 2. Build ARM64
# ---------------------------------------------------------
Write-Host "Preparing Dockerfile.arm64..."
# Builder stage runs on amd64 (fast), Target stage runs on arm64
$dockerfile_arm64 = $content.Replace('--platform=$BUILDPLATFORM', '--platform=linux/amd64').Replace('--platform=$TARGETPLATFORM', '--platform=linux/arm64')
Set-Content -Path "Dockerfile.arm64" -Value $dockerfile_arm64

Write-Host "Building ARM64..."
Retry-Command { docker build --no-cache -f Dockerfile.arm64 --build-arg HTTP_PROXY=$PROXY --build-arg HTTPS_PROXY=$PROXY -t "${IMAGE_NAME}:${VERSION}-arm64" . }

Write-Host "Pushing ARM64..."
Retry-Command { docker push "${IMAGE_NAME}:${VERSION}-arm64" }

# ---------------------------------------------------------
# 3. Create and Push Manifests
# ---------------------------------------------------------
# Cleanup old manifests
try { docker manifest rm "${IMAGE_NAME}:${VERSION}" } catch {}
try { docker manifest rm "${IMAGE_NAME}:latest" } catch {}

# Version Manifest
Write-Host "Creating Manifest for $VERSION..."
Retry-Command { docker manifest create --amend "${IMAGE_NAME}:${VERSION}" "${IMAGE_NAME}:${VERSION}-amd64" "${IMAGE_NAME}:${VERSION}-arm64" }

Write-Host "Pushing Manifest for $VERSION..."
Retry-Command { docker manifest push "${IMAGE_NAME}:${VERSION}" }

# Latest Manifest
Write-Host "Creating Manifest for latest..."
Retry-Command { docker manifest create --amend "${IMAGE_NAME}:latest" "${IMAGE_NAME}:${VERSION}-amd64" "${IMAGE_NAME}:${VERSION}-arm64" }

Write-Host "Pushing Manifest for latest..."
Retry-Command { docker manifest push "${IMAGE_NAME}:latest" }

# Cleanup temp files
Remove-Item Dockerfile.amd64
Remove-Item Dockerfile.arm64
try { Remove-Item Dockerfile.test } catch {}

Write-Host "Done!"
