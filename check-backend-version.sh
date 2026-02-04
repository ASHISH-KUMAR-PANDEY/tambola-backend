#!/bin/bash
# Check what version is actually running in App Runner

echo "Checking deployed backend version..."
curl -s https://jurpkxvw5m.ap-south-1.awsapprunner.com/health | jq '.'

echo ""
echo "Checking if backend accepts userName parameter..."
echo "This should show the actual running code version"
