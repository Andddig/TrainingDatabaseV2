#!/bin/bash

# Colors for terminal output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up BVAR19 Portal development environment...${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js is not installed. Please install Node.js before continuing.${NC}"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${YELLOW}npm is not installed. Please install npm before continuing.${NC}"
    exit 1
fi

# Install dependencies
echo -e "${GREEN}Installing dependencies...${NC}"
npm install

# Create necessary directories if they don't exist
echo -e "${GREEN}Creating necessary directories...${NC}"
mkdir -p public/img
mkdir -p logs

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating sample .env file...${NC}"
    cp .env.example .env || echo -e "PORT=3000\nNODE_ENV=development\nMONGODB_URI=mongodb://localhost:27017/bvar19-portal\nSESSION_SECRET=dev_session_secret\n\n# Microsoft OAuth credentials\n# You will need to register an app in Azure Portal\nMICROSOFT_CLIENT_ID=your_microsoft_client_id\nMICROSOFT_CLIENT_SECRET=your_microsoft_client_secret\nMICROSOFT_TENANT_ID=your_microsoft_tenant_id\nCALLBACK_URL=http://localhost:3000/auth/microsoft/callback" > .env
    echo -e "${YELLOW}Please update the .env file with your Microsoft credentials.${NC}"
fi

echo -e "${GREEN}Setup complete! You can now run the application with:${NC}"
echo -e "${GREEN}npm run dev${NC}"
echo -e "\n${YELLOW}For local testing without Microsoft SSO, you may want to implement a mock auth method.${NC}" 