$ErrorActionPreference = "Stop"
$env:DOCKER_CLI_EXPERIMENTAL="enabled"
$env:HTTP_PROXY="http://192.168.100.3:16888"
$env:HTTPS_PROXY="http://192.168.100.3:16888"

Write-Host "Retrying Manifest Push..."

try {
    Write-Host "Creating Manifest for 1.0.26BC..."
    docker manifest create --amend qdnas/flatnas:1.0.26BC qdnas/flatnas:1.0.26BC-amd64 qdnas/flatnas:1.0.26BC-arm64
    Write-Host "Pushing Manifest for 1.0.26BC..."
    docker manifest push qdnas/flatnas:1.0.26BC
} catch {
    Write-Host "Failed to push 1.0.26BC manifest: $_" -ForegroundColor Red
}

try {
    Write-Host "Creating Manifest for latest..."
    docker manifest create --amend qdnas/flatnas:latest qdnas/flatnas:1.0.26BC-amd64 qdnas/flatnas:1.0.26BC-arm64
    Write-Host "Pushing Manifest for latest..."
    docker manifest push qdnas/flatnas:latest
} catch {
    Write-Host "Failed to push latest manifest: $_" -ForegroundColor Red
}

Write-Host "Done."
