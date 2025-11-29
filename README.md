# Tunnel DDNS Worker

Automatically syncs Cloudflare Tunnel connection IPs to DNS records.

## Setup

Set secrets in Cloudflare dashboard (Worker Settings → Variables → Encrypt):

**CLOUDFLARE_API_TOKEN**

```
your-cloudflare-api-token
```

**APP_CONFIG** (JSON, minified to one line)

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

Push to GitHub - automatic deployment via Cloudflare GitHub integration.

## How It Works

Runs hourly:

1. Fetches active IPs from tunnel connections
2. Updates DNS records to match
3. Removes stale records

## License

MIT
