#!/bin/bash

# Navigate to the plugin directory
cd "$(dirname "$0")"

echo "Starting Manual Git Sync..."

# 1. Pull latest changes
echo "Pulling from GitHub..."
git pull origin main

# 2. Add all changes
echo "Adding changes..."
git add .

# 3. Commit changes
echo "Committing..."
git commit -m "Manual sync from Terminal"

# 4. Push to GitHub
echo "Pushing to GitHub..."
git push origin main

echo "Done! Press any key to close."
read -n 1 -s
