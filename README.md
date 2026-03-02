# ZDF Liveblogs to Discord

A Cloudflare Worker that monitors ZDF (Zweites Deutsches Fernsehen) liveblogs and automatically posts new updates to Discord threads.

## Overview

This worker periodically fetches updates from ZDF liveblogs and forwards them to Discord via webhooks. Each liveblog gets its own Discord thread, with updates posted in real-time as they become available. The worker tracks which updates have already been posted to avoid duplicates.

### Features

- **Automatic monitoring**: Scheduled to run every minute via Cloudflare Workers cron
- **Discord integration**: Posts updates to Discord threads with rich formatting
- **Duplicate prevention**: Tracks posted updates in Cloudflare D1 database
- **Rich message formatting**: Includes title, timestamp, content, images, and links
- **Multi-liveblog support**: Can monitor multiple ZDF liveblogs simultaneously

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

1. In Discord, go to Server Settings → Integrations → Webhooks
2. Create a new webhook and copy its URL
3. Store the webhook URL as a secret (see next section)

### Set up Cloudflare Secrets

Use Wrangler to set environment secrets:

```bash
wrangler secret put DISCORD_WEBHOOK_URL
```

When prompted, paste your Discord webhook URL.

### Configure Liveblogs

Edit `src/index.ts` and update the `liveBlogs` array with the ZDF liveblogs you want to monitor:

```typescript
const liveBlogs = [
	{
		name: "Liveblog Title",
		id: "unique-channel-id",
		blog: "https://liveblog.zdf.de/api/channels/unique-channel-id/blogitems/",
		url: "https://zdfheute.de/link-to-liveblog",
	},
	// Add more liveblogs as needed
];
```

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

## Project Structure

```
├── src/
│   └── index.ts          # Main worker code
├── test/                 # Test files
├── wrangler.jsonc        # Cloudflare Worker configuration
├── package.json          # Project dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── README.md             # This file
```

## Database Schema

The worker creates and uses two tables in Cloudflare D1:

### `live_blogs`

- `id` (TEXT PRIMARY KEY): Liveblog channel ID
- `thread_id` (TEXT): Discord thread ID where updates are posted

### `live_updates`

- `blog_id` (TEXT): Liveblog channel ID
- `guid` (TEXT): Unique identifier for each update
- PRIMARY KEY: `(blog_id, guid)`

These tables are created automatically on the first run.

## Scripts

- `npm run dev` - Start development server
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run test` - Run tests
- `npm run cf-typegen` - Regenerate Cloudflare type definitions

## Development

### Running Tests

```bash
npm test
```

### Adding New Liveblogs

1. Find the liveblog ID from the ZDF liveblog URL structure
2. Add a new entry to the `liveBlogs` array in `src/index.ts`
3. Redeploy the worker

## License

See LICENSE file for details.
