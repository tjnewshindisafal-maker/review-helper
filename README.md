# ReviewHelper - Google Review AI Generator

## Setup Instructions

### Step 1: Install Node.js
Download from: https://nodejs.org (version 18 or higher)

### Step 2: Get Anthropic API Key
1. Go to: https://console.anthropic.com
2. Sign up / Login
3. Click "API Keys" → "Create Key"
4. Copy the key

### Step 3: Add API Key
Open `server.js` and replace:
  YOUR_API_KEY_HERE
with your actual API key.

OR set as environment variable:
  Windows:  set ANTHROPIC_API_KEY=your_key_here
  Mac/Linux: export ANTHROPIC_API_KEY=your_key_here

### Step 4: Install & Run
Open terminal/command prompt in this folder and run:

  npm install
  node server.js

### Step 5: Open in browser
Go to: http://localhost:3000

### Step 6: Setup Business Settings
- Click "Business Settings" in the app
- Enter your business name
- Enter your Google Review URL
- Click Save

---

## To get your Google Review URL:
1. Search your business on Google Maps
2. Click "Reviews" tab
3. Click "Write a review"
4. Copy that URL

---

## For Production (hosting online):
- Deploy to: Railway.app, Render.com, or Heroku (all free)
- Set ANTHROPIC_API_KEY as environment variable
- Share the hosted URL and make a QR code from it
