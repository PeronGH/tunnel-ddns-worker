import { isIPv4, isIPv6 } from "node:net";
import Cloudflare from "cloudflare";
import type { RecordResponse } from "cloudflare/resources/dns/records";

// --- Shared Types ---

interface SyncParams {
	zoneId: string;
	domain: string;
	type: "A" | "AAAA";
	targetIPs: string[];
}

// --- Configuration Types ---

interface ZoneConfig {
	records: {
		[domain: string]: ("A" | "AAAA")[];
	};
}

interface TunnelDefinition {
	zones: {
		[zoneId: string]: ZoneConfig;
	};
}

interface AppConfig {
	account_id: string;
	tunnels: {
		[tunnelId: string]: TunnelDefinition;
	};
}

interface Env {
	CLOUDFLARE_API_TOKEN: string;
	APP_CONFIG: string;
}

// --- Worker Entry Point ---

export default {
	async scheduled(_event, env, ctx) {
		ctx.waitUntil(runSync(env));
	},
} satisfies ExportedHandler<Env>;

/**
 * Orchestrates the synchronization process.
 */
async function runSync(env: Env): Promise<void> {
	console.log("Starting Tunnel Sync...");

	let config: AppConfig;
	try {
		config = JSON.parse(env.APP_CONFIG);
	} catch (e) {
		console.error(`Critical: Failed to parse APP_CONFIG JSON. ${e}`);
		return;
	}

	const client = new Cloudflare({
		apiToken: env.CLOUDFLARE_API_TOKEN,
	});

	// Iterate over tunnels
	for (const [tunnelId, tunnelInfo] of Object.entries(config.tunnels)) {
		console.log(`Processing Tunnel: ${tunnelId}`);

		try {
			const activeIPs = new Set<string>();
			for await (const clientConn of client.zeroTrust.tunnels.cloudflared.connections.get(
				tunnelId,
				{
					account_id: config.account_id,
				},
			)) {
				for (const conn of clientConn.conns || []) {
					if (conn.origin_ip) activeIPs.add(conn.origin_ip);
				}
			}

			const ipv4s = [...activeIPs].filter(isIPv4);
			const ipv6s = [...activeIPs].filter(isIPv6);

			// Iterate over zones and records
			for (const [zoneId, zoneConfig] of Object.entries(tunnelInfo.zones)) {
				for (const [domain, recordTypes] of Object.entries(
					zoneConfig.records,
				)) {
					if (recordTypes.includes("A")) {
						await syncRecords(client, {
							zoneId,
							domain,
							type: "A",
							targetIPs: ipv4s,
						});
					}

					if (recordTypes.includes("AAAA")) {
						await syncRecords(client, {
							zoneId,
							domain,
							type: "AAAA",
							targetIPs: ipv6s,
						});
					}
				}
			}
		} catch (err) {
			console.error(`Error processing tunnel ${tunnelId}: ${err}`);
		}
	}

	console.log("Sync Complete.");
}

/**
 * Syncs DNS records for a specific domain/type combination.
 */
async function syncRecords(client: Cloudflare, params: SyncParams) {
	const { zoneId, domain, type, targetIPs } = params;

	// 1. Fetch current state
	const existingRecords: RecordResponse[] = [];
	for await (const record of client.dns.records.list({
		zone_id: zoneId,
		name: { exact: domain },
		type,
	})) {
		existingRecords.push(record);
	}

	const existingMap = new Map<string, string>();
	for (const r of existingRecords) {
		if (r.content) {
			existingMap.set(r.content, r.id);
		}
	}

	// 2. Calculate Diffs
	const desiredIPs = new Set(targetIPs);
	const toCreate = targetIPs.filter((ip) => !existingMap.has(ip));
	const toDelete = existingRecords.filter(
		(r) => r.content && !desiredIPs.has(r.content),
	);

	if (toCreate.length === 0 && toDelete.length === 0) return;

	// 3. Execute Updates (Create-before-Delete)
	for (const ip of toCreate) {
		console.log(`Creating ${type} record for ${domain} -> ${ip}`);
		await client.dns.records.create({
			zone_id: zoneId,
			name: domain,
			type,
			content: ip,
			ttl: 60,
			proxied: false,
		});
	}

	for (const record of toDelete) {
		console.log(`Deleting ${type} record for ${domain} -> ${record.content}`);
		await client.dns.records.delete(record.id, { zone_id: zoneId });
	}
}
