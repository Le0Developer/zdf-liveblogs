# ZDF Liveblogs to Discord

A Cloudflare Worker that monitors ZDF (Zweites Deutsches Fernsehen) liveblogs and automatically posts new updates to Discord threads.

## Overview

This worker periodically fetches updates from ZDF liveblogs and forwards them to Discord via webhooks. Each liveblog gets its own Discord thread, with updates posted in real-time as they become available. The worker tracks which updates have already been posted to avoid duplicates.

### Features

- **Automatic monitoring**: Scheduled to run every minute via Cloudflare Workers cron
- **Discord integration**: Posts updates to Discord threads with rich formatting
- **Duplicate prevention**: Tracks posted updates in Cloudflare D1 database
- **Rich message formatting**: Includes title, timestamp, content, images, and links
- **Liveblog auto-discovery**: Liveblogs are automatically discovered

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (Cloudflare Workers CLI)
- A Cloudflare account with Workers enabled
- A Discord server and webhook URL for posting updates

## Installation

1. **Clone the repository**:

   ```bash
   git clone https://github.com/le0developer/zdf-liveblogs
   cd zdf-liveblogs
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Generate Cloudflare types**:
   ```bash
   npm run cf-typegen
   ```

## Configuration

### Set up Discord Webhook

1. In Discord, create a Forum channel (MUST be a Forum channel!)
2. Right click the channel > Edit Channel > Integrations > Webhooks
3. Create a new webhook and copy its URL
4. Store the webhook URL as a secret (see next section)

### Set up Cloudflare Secrets

Use Wrangler to set environment secrets:

```bash
wrangler secret put DISCORD_WEBHOOK_URL
```

When prompted, paste your Discord webhook URL.

Create a `.env` file for local testing.

## Deployment

### Development

Start a local development server:

```bash
npm run dev
```

This runs the worker locally at `http://localhost:8787/`.

### Production

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

This publishes the worker to your Cloudflare account. The scheduled trigger (cron) will automatically run every minute.
