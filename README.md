# Tunnel DDNS Worker

Automatically syncs Cloudflare Tunnel connection IPs to DNS records.

## Setup

Create a Cloudflare API token with these permissions:

- Account > Cloudflare Tunnel > Read
- Zone > DNS > Edit

Set secrets using wrangler:

```bash
wrangler secret put CLOUDFLARE_API_TOKEN
# Enter your API token when prompted

wrangler secret put APP_CONFIG
# Enter your config JSON when prompted
```

**APP_CONFIG** format:

```json
{
	"account_id": "your-cloudflare-account-id",
	"tunnels": {
		"tunnel-id-1": {
			"zones": {
				"zone-id-1": {
					"records": {
						"example.com": ["A", "AAAA"],
						"subdomain.example.com": ["AAAA"]
					}
				}
			}
		}
	}
}
```

## Local Development

```bash
bun install
bun run dev
```

Create `.dev.vars`:

```
CLOUDFLARE_API_TOKEN=your-token
APP_CONFIG={"account_id":"...","tunnels":{...}}
```

## Deploy

1. Fork this repo
2. Create a Cloudflare Worker
3. Connect your fork via Cloudflare's GitHub integration
4. Set the secrets in Cloudflare dashboard
5. Push to your fork to deploy

## How It Works

Runs hourly:

1. Fetches active IPs from tunnel connections
2. Updates DNS records to match
3. Removes stale records

## License

MIT
