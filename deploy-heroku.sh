#!/bin/bash
# Script to deploy the Discord transcription bot to Heroku

# App name and team
APP_NAME="discord-transcription-bot"
TEAM="sacra"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Deploying Discord Transcription Bot to Heroku under team $TEAM...${NC}"

# Check if Heroku CLI is installed
if ! command -v heroku &> /dev/null; then
    echo -e "${RED}Heroku CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if logged in to Heroku
heroku whoami &> /dev/null
if [ $? -ne 0 ]; then
    echo -e "${RED}Not logged in to Heroku. Please run 'heroku login' first.${NC}"
    exit 1
fi

# Print Heroku account info for debugging
echo -e "${YELLOW}Heroku account information:${NC}"
heroku auth:whoami

# List all team apps for debugging
echo -e "${YELLOW}Listing all Heroku apps for team $TEAM:${NC}"
heroku apps --team $TEAM

# Check if app exists
if heroku apps:info $APP_NAME &> /dev/null; then
    echo -e "${GREEN}App $APP_NAME exists. Updating...${NC}"
else
    echo -e "${RED}App $APP_NAME does not exist.${NC}"
    
    # Ask if user wants to create the app
    echo -e "${YELLOW}Do you want to create the app under team $TEAM? (y/n)${NC}"
    read -p "> " CREATE_APP
    
    if [[ $CREATE_APP == "y" || $CREATE_APP == "Y" ]]; then
        echo -e "${YELLOW}Creating app $APP_NAME under team $TEAM...${NC}"
        heroku create $APP_NAME --team $TEAM
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}App created successfully under team $TEAM.${NC}"
        else
            echo -e "${RED}Failed to create app. Exiting.${NC}"
            exit 1
        fi
    else
        echo -e "${RED}Exiting deployment.${NC}"
        exit 1
    fi
fi

# Prompt for environment variables if not set
echo -e "${YELLOW}Checking environment variables...${NC}"

# Function to check and set config vars
check_and_set_var() {
    local var_name=$1
    local prompt_text=$2
    local current_value=$(heroku config:get $var_name --app $APP_NAME 2>/dev/null)
    
    if [ -z "$current_value" ]; then
        echo -e "${YELLOW}$prompt_text${NC}"
        read -p "> " var_value
        
        if [ -n "$var_value" ]; then
            heroku config:set $var_name="$var_value" --app $APP_NAME
            echo -e "${GREEN}Set $var_name successfully.${NC}"
        else
            echo -e "${RED}Warning: $var_name not set.${NC}"
        fi
    else
        echo -e "${GREEN}$var_name is already set.${NC}"
    fi
}

check_and_set_var "DISCORD_TOKEN" "Enter your Discord bot token:"
check_and_set_var "DEEPGRAM_TOKEN" "Enter your Deepgram API token:"
check_and_set_var "CLAUDE_API_KEY" "Enter your Claude API key (optional, press Enter to skip):"
check_and_set_var "DEFAULT_CHANNEL" "Enter the default channel name for transcripts (default: transcripts):"
check_and_set_var "TRANSCRIPT_CHANNEL_ID" "Enter the transcript channel ID (optional, press Enter to skip):"

# Set buildpacks
echo -e "${YELLOW}Setting buildpacks...${NC}"
heroku buildpacks:clear --app $APP_NAME
heroku buildpacks:add https://github.com/jonathanong/heroku-buildpack-ffmpeg-latest.git --app $APP_NAME
heroku buildpacks:add heroku/nodejs --app $APP_NAME

# Set up Git remote
echo -e "${YELLOW}Setting up Git remote...${NC}"
heroku git:remote --app $APP_NAME

# Deploy to Heroku
echo -e "${YELLOW}Deploying to Heroku...${NC}"
git push heroku main

# Scale dynos - ensure web is scaled to 0 and worker is scaled to 1
echo -e "${YELLOW}Scaling dynos...${NC}"
heroku ps:scale web=0 worker=1 --app $APP_NAME

echo -e "${GREEN}Deployment complete!${NC}"
echo -e "${YELLOW}To view logs, run: heroku logs --tail --app $APP_NAME${NC}" 