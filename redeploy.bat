@echo off
echo Stopping and removing old container...
docker rm -f flatnas_container

echo Building new image...
docker build -t flatnas:latest .

echo Cleaning up dangling images...
docker image prune -f

echo Running new container with data persistence...
set "CURRENT_DIR=%cd%"

docker run -d --name flatnas_container -p 3000:3000 -v "%CURRENT_DIR%\data":/app/server/data -v "%CURRENT_DIR%\music":/app/server/music --restart unless-stopped flatnas:latest

echo.
echo FlatNas has been redeployed successfully!
echo Data will be stored in 'data' folder and music in 'music' folder.
pause
