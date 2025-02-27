#!/bin/bash
# Script to deploy Discord slash commands

echo "Compiling TypeScript..."
npx tsc

echo "Running deploy-commands.js..."
node dist/deploy-commands.js

echo "Done!" 