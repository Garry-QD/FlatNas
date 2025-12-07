@echo off
REM Build and push for AMD64
echo Building for linux/amd64...
docker build --platform linux/amd64 -t qdnas/flatnas:1.0.13-amd64 .
docker push qdnas/flatnas:1.0.13-amd64

REM Build and push for ARM64
echo Building for linux/arm64...
docker build --platform linux/arm64 -t qdnas/flatnas:1.0.13-arm64 .
docker push qdnas/flatnas:1.0.13-arm64

REM Build and push for ARMv7
echo Building for linux/arm/v7...
REM Use legacy builder for ARMv7 to avoid buildx issues in some environments
set DOCKER_BUILDKIT=0
docker build --no-cache --platform linux/arm/v7 -t qdnas/flatnas:1.0.13-armv7 .
set DOCKER_BUILDKIT=1
docker push qdnas/flatnas:1.0.13-armv7

REM Create and push manifest for 1.0.13
echo Creating manifest for 1.0.13...
docker manifest create qdnas/flatnas:1.0.13 qdnas/flatnas:1.0.13-amd64 qdnas/flatnas:1.0.13-arm64 qdnas/flatnas:1.0.13-armv7
docker manifest push qdnas/flatnas:1.0.13

REM Create and push manifest for latest
echo Creating manifest for latest...
docker manifest create qdnas/flatnas:latest qdnas/flatnas:1.0.13-amd64 qdnas/flatnas:1.0.13-arm64 qdnas/flatnas:1.0.13-armv7
docker manifest push qdnas/flatnas:latest

echo Done!
