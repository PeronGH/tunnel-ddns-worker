import { isIPv4, isIPv6 } from 'node:net';
import Cloudflare from 'cloudflare';
import type { RecordResponse } from 'cloudflare/resources/dns/records';

// --- Shared Types ---

interface SyncParams {
	zoneId: string;
	domain: string;
	type: 'A' | 'AAAA';
	targetIPs: string[];
}

// --- Configuration Types ---

interface ZoneConfig {
	records: {
		[domain: string]: ('A' | 'AAAA')[];
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
	async scheduled(_event, env, _ctx) {
		let config: AppConfig;
		try {
			config = JSON.parse(env.APP_CONFIG);
		} catch (error) {
			console.error('Critical: Failed to parse APP_CONFIG JSON.', error);
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
				for await (const clientConn of client.zeroTrust.tunnels.cloudflared.connections.get(tunnelId, {
					account_id: config.account_id,
				})) {
					for (const conn of clientConn.conns || []) {
						if (conn.origin_ip) activeIPs.add(conn.origin_ip);
					}
				}

				const ipv4s = [...activeIPs].filter(isIPv4);
				const ipv6s = [...activeIPs].filter(isIPv6);

				// Iterate over zones and records
				for (const [zoneId, zoneConfig] of Object.entries(tunnelInfo.zones)) {
					for (const [domain, recordTypes] of Object.entries(zoneConfig.records)) {
						const syncTasks: Promise<void>[] = [];

						if (recordTypes.includes('A')) {
							syncTasks.push(
								syncRecords(client, {
									zoneId,
									domain,
									type: 'A',
									targetIPs: ipv4s,
								}),
							);
						}

						if (recordTypes.includes('AAAA')) {
							syncTasks.push(
								syncRecords(client, {
									zoneId,
									domain,
									type: 'AAAA',
									targetIPs: ipv6s,
								}),
							);
						}

						await Promise.all(syncTasks);
					}
				}
			} catch (error) {
				console.error(`Error processing tunnel ${tunnelId}:`, error);
			}
		}
	},
} satisfies ExportedHandler<Env>;

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
	const toDelete = existingRecords.filter((r) => r.content && !desiredIPs.has(r.content));

	if (toCreate.length === 0 && toDelete.length === 0) {
		console.log(`No changes needed for ${type} record ${domain}`);
		return;
	}

	// 3. Execute Updates (Create-before-Delete)
	await Promise.all(
		toCreate.map((ip) => {
			console.log(`Creating ${type} record for ${domain} -> ${ip}`);
			return client.dns.records.create({
				zone_id: zoneId,
				name: domain,
				type,
				content: ip,
				ttl: 60,
				proxied: false,
			});
		}),
	);

	await Promise.all(
		toDelete.map((record) => {
			console.log(`Deleting ${type} record for ${domain} -> ${record.content}`);
			return client.dns.records.delete(record.id, { zone_id: zoneId });
		}),
	);
}
