// Scores how likely an extracted address belongs to the target GitHub handle.
// This is a similarity heuristic over the handle and the address, not identity
// resolution — it ranks addresses, it does not prove ownership.

export type MatchTier = 'likely' | 'possible' | 'unlikely';

export interface EmailMatch {
	address: string;
	score: number; // 0–100 confidence the address belongs to the handle
	tier: MatchTier;
	reason: string; // short, human-readable explanation
}

// Common free-mail hosts: a matching domain here carries no ownership signal.
const FREEMAIL = new Set([
	'gmail.com',
	'googlemail.com',
	'outlook.com',
	'hotmail.com',
	'live.com',
	'msn.com',
	'yahoo.com',
	'icloud.com',
	'me.com',
	'mac.com',
	'proton.me',
	'protonmail.com',
	'pm.me',
	'aol.com',
	'gmx.com',
	'mail.com',
	'yandex.com',
	'zoho.com'
]);

// Local parts that rarely identify a person on their own.
const GENERIC_LOCAL = new Set([
	'me',
	'git',
	'dev',
	'admin',
	'info',
	'contact',
	'hello',
	'hi',
	'mail',
	'email',
	'user',
	'root',
	'support',
	'team',
	'hey',
	'oss'
]);

const lower = (s: string) => s.toLowerCase();
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Sørensen–Dice coefficient over character bigrams. Bounded 0..1, tolerant of
// reordering and minor edits, cheap to compute.
function dice(a: string, b: string): number {
	if (a === b) return a.length ? 1 : 0;
	if (a.length < 2 || b.length < 2) return 0;

	const bigrams = (s: string) => {
		const m = new Map<string, number>();
		for (let i = 0; i < s.length - 1; i++) {
			const g = s.slice(i, i + 2);
			m.set(g, (m.get(g) ?? 0) + 1);
		}
		return m;
	};

	const A = bigrams(a);
	const B = bigrams(b);
	let intersection = 0;
	let total = 0;
	for (const [g, c] of A) {
		total += c;
		const d = B.get(g);
		if (d) intersection += Math.min(c, d);
	}
	for (const [, c] of B) total += c;
	return total === 0 ? 0 : (2 * intersection) / total;
}

// Splits a handle into meaningful sub-tokens (separators + camelCase boundaries).
function handleTokens(username: string): string[] {
	return username
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.split(/[^a-zA-Z0-9]+/)
		.map(lower)
		.filter((t) => t.length >= 3);
}

// Returns the registrable label of a domain (e.g. "torvalds" in torvalds.dev).
function domainLabel(domain: string): string {
	const parts = domain.split('.');
	return parts.length >= 2 ? parts[parts.length - 2] : domain;
}

// Scores a single address against the target handle.
export function scoreMatch(username: string, address: string): EmailMatch {
	const handle = alnum(username);
	const at = address.indexOf('@');
	const localRaw = lower(address.slice(0, at));
	const domain = lower(address.slice(at + 1));
	const local = alnum(localRaw);
	const label = domainLabel(domain);

	let score = 0;
	let reason = 'no clear link to the handle';

	// 1) Local-part structure — the strongest signal.
	if (local && local === handle) {
		score = 96;
		reason = 'local part matches the handle exactly';
	} else if (handle.length >= 3 && local && (local.includes(handle) || handle.includes(local))) {
		score = 78;
		reason = 'local part contains the handle';
	} else {
		const sim = dice(local, handle);
		if (sim >= 0.6) {
			score = Math.round(55 + sim * 30);
			reason = 'local part closely resembles the handle';
		} else if (sim >= 0.35) {
			score = Math.round(28 + sim * 30);
			reason = 'local part loosely resembles the handle';
		} else {
			score = Math.round(sim * 28);
		}
	}

	// 2) Token overlap — handle built from name parts (e.g. "jane-doe" → "jdoe").
	if (score < 70) {
		for (const token of handleTokens(username)) {
			if (localRaw.includes(token)) {
				score = Math.max(score, 66);
				reason = 'local part includes part of the handle';
				break;
			}
		}
	}

	// 3) Domain ownership — a non-freemail domain that matches the handle is a
	//    strong signal the person controls the address.
	if (!FREEMAIL.has(domain)) {
		if (label === handle || (handle.length >= 4 && label.includes(handle))) {
			if (score < 88) {
				score = 88;
				reason = 'address sits on a domain matching the handle';
			}
		} else if (dice(label, handle) >= 0.6 && score < 60) {
			score = 60;
			reason = 'address domain resembles the handle';
		}
	}

	// 4) Generic local part with no strong structural signal → damp down.
	if (GENERIC_LOCAL.has(localRaw) && score < 80) {
		score = Math.min(score, 20);
		reason = 'generic address, hard to attribute';
	}

	score = Math.max(0, Math.min(100, score));
	const tier: MatchTier = score >= 70 ? 'likely' : score >= 35 ? 'possible' : 'unlikely';
	return { address, score, tier, reason };
}

// Scores a list of addresses and orders them best-match first.
export function rankMatches(username: string, addresses: string[]): EmailMatch[] {
	return addresses
		.map((address) => scoreMatch(username, address))
		.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
}
