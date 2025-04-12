@echo off
echo Starting BVAR19 Portal Docker development environment...

rem Check if .env file exists, copy example if not
if not exist .env (
    echo Creating .env file from example...
    copy .env.example .env
    echo Please update your .env file with proper credentials before continuing.
    pause
    exit
)

rem Build and start Docker containers
echo Building and starting Docker containers...
docker-compose -f docker-compose-dev.yml up --build

rem This will keep the command window open until the containers are stopped with Ctrl+C 