$ErrorActionPreference = "Stop"

# Set Proxy
$env:HTTP_PROXY = "http://192.168.100.3:16888"
$env:HTTPS_PROXY = "http://192.168.100.3:16888"

$VERSION = "1.0.15"
$IMAGE_NAME = "qdnas/flatnas"
$BUILDX_EXE = "D:\Program Files\Docker\Docker\resources\cli-plugins\docker-buildx.exe"

# Enable experimental features for manifest command
$env:DOCKER_CLI_EXPERIMENTAL = "enabled"

Write-Host "--------------------------------------------------"
Write-Host "Building and pushing for linux/amd64..."
Write-Host "--------------------------------------------------"
& $BUILDX_EXE build --platform linux/amd64 --provenance=false -t "${IMAGE_NAME}:${VERSION}-amd64" --load .
if ($LASTEXITCODE -ne 0) { exit 1 }
docker push "${IMAGE_NAME}:${VERSION}-amd64"
# Retry push if failed
if ($LASTEXITCODE -ne 0) { 
    Write-Host "Push failed, retrying..."
    docker push "${IMAGE_NAME}:${VERSION}-amd64"
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

Write-Host "--------------------------------------------------"
Write-Host "Building and pushing for linux/arm64..."
Write-Host "--------------------------------------------------"
& $BUILDX_EXE build --platform linux/arm64 --provenance=false -t "${IMAGE_NAME}:${VERSION}-arm64" --load .
if ($LASTEXITCODE -ne 0) { exit 1 }
docker push "${IMAGE_NAME}:${VERSION}-arm64"
# Retry push if failed
if ($LASTEXITCODE -ne 0) { 
    Write-Host "Push failed, retrying..."
    docker push "${IMAGE_NAME}:${VERSION}-arm64"
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

Write-Host "--------------------------------------------------"
Write-Host "Creating and pushing manifest list for ${VERSION}..."
Write-Host "--------------------------------------------------"
# Remove existing manifest if any (ignore error)
try { docker manifest rm "${IMAGE_NAME}:${VERSION}" 2>$null } catch {}
if ($LASTEXITCODE -ne 0) { $LASTEXITCODE = 0 }

# Use --amend to merge manifests
docker manifest create "${IMAGE_NAME}:${VERSION}" --amend "${IMAGE_NAME}:${VERSION}-amd64" --amend "${IMAGE_NAME}:${VERSION}-arm64"
if ($LASTEXITCODE -ne 0) { exit 1 }
docker manifest push "${IMAGE_NAME}:${VERSION}"
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "--------------------------------------------------"
Write-Host "Creating and pushing manifest list for latest..."
Write-Host "--------------------------------------------------"
try { docker manifest rm "${IMAGE_NAME}:latest" 2>$null } catch {}
if ($LASTEXITCODE -ne 0) { $LASTEXITCODE = 0 }

docker manifest create "${IMAGE_NAME}:latest" --amend "${IMAGE_NAME}:${VERSION}-amd64" --amend "${IMAGE_NAME}:${VERSION}-arm64"
if ($LASTEXITCODE -ne 0) { exit 1 }
docker manifest push "${IMAGE_NAME}:latest"
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "--------------------------------------------------"
Write-Host "Build and Push Complete!"
Write-Host "--------------------------------------------------"
