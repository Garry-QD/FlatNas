#!/bin/bash

# Build the Docker image
docker build -t qdnas/flatnas:1.0.5-dev .

# Tag as latest
docker tag qdnas/flatnas:1.0.5-dev qdnas/flatnas:latest

# Push to Docker Hub
docker push qdnas/flatnas:1.0.5-dev
docker push qdnas/flatnas:latest

echo "Docker image built, tagged, and pushed as qdnas/flatnas:1.0.5-dev and qdnas/flatnas:latest"
