#!/bin/bash

# Build the Docker image
docker build -t qdnas/flatnas:1.0.8 .

# Tag as latest
docker tag qdnas/flatnas:1.0.8 qdnas/flatnas:latest

# Push to Docker Hub
docker push qdnas/flatnas:1.0.8
docker push qdnas/flatnas:latest

echo "Docker image built, tagged, and pushed as qdnas/flatnas:1.0.8 and qdnas/flatnas:latest"
