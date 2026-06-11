// Scrapes GitHub commit patches to surface email addresses from public repositories.

const USER_AGENTS = [
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
	'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'
];

// Single line-anchored pass over each patch instead of five separate scans.
// Matches the address inside the angle brackets of any known git header.
const HEADER_EMAIL =
	/^(?:From|Author|Committer|Signed-off-by|Co-authored-by):.*?<([^>]+)>/gim;

const FILTERED_DOMAINS = new Set([
	'users.noreply.github.com',
	'example.com',
	'test.com',
	'localhost',
	'noreply.com',
	'email.com',
	'foo.com',
	'bar.com',
	'test.org',
	'example.org',
	'example.net'
]);

const EXCLUDED_PATHS = new Set([
	'followers',
	'following',
	'repositories',
	'projects',
	'packages',
	'stars',
	'sponsoring',
	'sponsors',
	'.github'
]);

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_REPOS = 6;
const MAX_COMMITS = 5;
const RETRY_DELAY_MS = 3000;

export interface ExtractResult {
	username: string;
	repos_scanned: number;
	emails: string[];
	email_count: number;
}

function randomAgent(): string {
	return USER_AGENTS[(Math.random() * USER_AGENTS.length) | 0];
}

// Escapes regex metacharacters so dynamic repo/user names can't over-match.
function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Validity + domain/noreply filtering for a single lowercased address.
function isValidEmail(email: string): boolean {
	if (email.startsWith('noreply@') || email.startsWith('no-reply@')) return false;
	if (email.includes('..') || email.includes('@.')) return false;
	const at = email.indexOf('@');
	if (at < 1) return false;
	if (FILTERED_DOMAINS.has(email.slice(at + 1))) return false;
	return VALID_EMAIL.test(email);
}

// Pulls every valid header email out of a raw patch in one regex pass.
function collectFromPatch(patch: string, into: Set<string>): void {
	HEADER_EMAIL.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = HEADER_EMAIL.exec(patch)) !== null) {
		const email = match[1].trim().toLowerCase();
		if (isValidEmail(email)) into.add(email);
	}
}

// Fetches a URL with a rotated UA; retries once on 429, returns null on failure.
async function fetchPage(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, {
			headers: {
				'User-Agent': randomAgent(),
				Accept: 'text/html,application/xhtml+xml,*/*'
			}
		});

		if (res.status === 429) {
			await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
			const retry = await fetch(url, { headers: { 'User-Agent': randomAgent() } });
			return retry.ok ? retry.text() : null;
		}
		return res.ok ? res.text() : null;
	} catch {
		return null;
	}
}

function sanitizeUsername(raw: string): string {
	return raw
		.trim()
		.replace(/^https?:\/\/(www\.)?github\.com\/?/i, '')
		.replace(/\/.*$/, '')
		.replace(/^@/, '')
		.trim();
}

function isValidUsername(username: string): boolean {
	if (username.length < 1 || username.length > 39) return false;
	if (username.startsWith('-') || username.endsWith('-') || username.includes('--')) return false;
	return /^[a-zA-Z0-9-]+$/.test(username);
}

// Lists source repos from the profile's repository tab. The first page also
// serves as the existence check — a missing user 404s here, so no separate
// profile request is needed.
async function getRepos(username: string): Promise<{ repos: string[]; exists: boolean }> {
	const repos: string[] = [];
	const seen = new Set<string>();
	const pattern = new RegExp(`href="/${escapeRegex(username)}/([^/"?#]+)"`, 'gi');
	let exists = false;

	for (let page = 1; page <= 2; page++) {
		const html = await fetchPage(
			`https://github.com/${username}?tab=repositories&page=${page}&type=source`
		);
		if (!html) break;
		exists = true;

		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(html)) !== null) {
			const name = match[1];
			const key = name.toLowerCase();
			if (!seen.has(key) && !EXCLUDED_PATHS.has(key)) {
				seen.add(key);
				repos.push(name);
			}
		}
		if (repos.length >= MAX_REPOS) break;
	}

	return { repos: repos.slice(0, MAX_REPOS), exists };
}

// Reads up to MAX_COMMITS commit SHAs from a repo's commits page.
async function getCommitShas(username: string, repo: string): Promise<string[]> {
	const html = await fetchPage(`https://github.com/${username}/${repo}/commits`);
	if (!html) return [];

	const shas = new Set<string>();
	const pattern = new RegExp(
		`/${escapeRegex(username)}/${escapeRegex(repo)}/commit/([a-f0-9]{40})`,
		'gi'
	);
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(html)) !== null) {
		shas.add(match[1]);
		if (shas.size >= MAX_COMMITS) break;
	}
	return [...shas];
}

// Fetches each commit patch for a repo in parallel and aggregates emails.
async function processRepo(username: string, repo: string): Promise<Set<string>> {
	const shas = await getCommitShas(username, repo);
	const emails = new Set<string>();
	if (shas.length === 0) return emails;

	const patches = await Promise.all(
		shas.map((sha) => fetchPage(`https://github.com/${username}/${repo}/commit/${sha}.patch`))
	);
	for (const patch of patches) {
		if (patch) collectFromPatch(patch, emails);
	}
	return emails;
}

// Full pipeline: validate → list repos (also confirms the user) → scan patches.
export async function extractEmails(rawUsername: string): Promise<ExtractResult> {
	const username = sanitizeUsername(rawUsername);
	if (!isValidUsername(username)) {
		throw new Error('invalid github username');
	}

	const { repos, exists } = await getRepos(username);
	if (!exists) {
		throw new Error('user not found');
	}
	if (repos.length === 0) {
		return { username, repos_scanned: 0, emails: [], email_count: 0 };
	}

	const repoResults = await Promise.all(repos.map((repo) => processRepo(username, repo)));
	const allEmails = new Set<string>();
	for (const set of repoResults) {
		for (const email of set) allEmails.add(email);
	}

	const sorted = [...allEmails].sort();
	return {
		username,
		repos_scanned: repos.length,
		emails: sorted,
		email_count: sorted.length
	};
}
