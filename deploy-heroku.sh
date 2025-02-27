#!/bin/bash
# Script to deploy the Discord transcription bot to Heroku

# Set app name
APP_NAME="discord-transcription-bot"
TEAM="sacra"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Deploying Discord Transcription Bot to Heroku...${NC}"

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

# Check if app exists
if heroku apps:info --app $APP_NAME --team $TEAM &> /dev/null; then
    echo -e "${GREEN}App $APP_NAME already exists. Updating...${NC}"
else
    echo -e "${YELLOW}Creating new Heroku app: $APP_NAME${NC}"
    heroku create $APP_NAME --team $TEAM
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to create Heroku app. Exiting.${NC}"
        exit 1
    fi
fi

# Prompt for environment variables if not set
echo -e "${YELLOW}Checking environment variables...${NC}"

# Function to check and set config vars
check_and_set_var() {
    local var_name=$1
    local prompt_text=$2
    local current_value=$(heroku config:get $var_name --app $APP_NAME --team $TEAM 2>/dev/null)
    
    if [ -z "$current_value" ]; then
        echo -e "${YELLOW}$prompt_text${NC}"
        read -p "> " var_value
        
        if [ -n "$var_value" ]; then
            heroku config:set $var_name="$var_value" --app $APP_NAME --team $TEAM
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
heroku buildpacks:clear --app $APP_NAME --team $TEAM
heroku buildpacks:add https://github.com/jonathanong/heroku-buildpack-ffmpeg-latest.git --app $APP_NAME --team $TEAM
heroku buildpacks:add heroku/nodejs --app $APP_NAME --team $TEAM

# Deploy to Heroku
echo -e "${YELLOW}Deploying to Heroku...${NC}"
git push https://git.heroku.com/$APP_NAME.git HEAD:main

# Scale dynos
echo -e "${YELLOW}Scaling worker dyno...${NC}"
heroku ps:scale worker=1 --app $APP_NAME --team $TEAM

echo -e "${GREEN}Deployment complete!${NC}"
echo -e "${YELLOW}To view logs, run: heroku logs --tail --app $APP_NAME --team $TEAM${NC}" 