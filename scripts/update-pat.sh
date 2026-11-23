#!/usr/bin/env bash
# Securely configures or updates your GitHub Personal Access Token (PAT) for WhoseTab.

set -e

USERNAME="KHILVANSH"
REPO="WhoseTab"

echo "=========================================================="
echo "       WhoseTab — GitHub PAT Credentials Helper          "
echo "=========================================================="

if [ -z "$1" ]; then
    read -sp "Enter GitHub Personal Access Token (PAT): " TOKEN
    echo ""
else
    TOKEN="$1"
fi

if [ -z "$TOKEN" ]; then
    echo "Error: Token cannot be empty."
    exit 1
fi

AUTHENTICATED_URL="https://${USERNAME}:${TOKEN}@github.com/${USERNAME}/${REPO}.git"

echo "Updating git remote origin..."
if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$AUTHENTICATED_URL"
else
    git remote add origin "$AUTHENTICATED_URL"
fi

echo "Testing connection with GitHub..."
if git ls-remote origin >/dev/null 2>&1; then
    echo "✓ Successfully authenticated with private repository ${USERNAME}/${REPO}!"
    echo "You can now run 'git push origin main' or 'git pull' without login prompts."
else
    echo "✗ Authentication failed. Please verify your token has 'repo' scope."
    exit 1
fi
