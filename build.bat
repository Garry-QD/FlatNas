# Build the Docker image
docker build -t qdnas/flatnas:1.0.11 .

# Tag as latest
docker tag qdnas/flatnas:1.0.11 qdnas/flatnas:latest

# Push to Docker Hub
docker push qdnas/flatnas:1.0.11
docker push qdnas/flatnas:latest

Write-Host "Docker image built, tagged, and pushed as qdnas/flatnas:1.0.11 and qdnas/flatnas:latest"
