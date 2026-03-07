// Scrapes GitHub commit patches to extract email addresses from public repositories

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

const EMAIL_PATTERNS: RegExp[] = [
	/From:\s*.*?<([^>]+)>/g,
	/Author:\s*.*?<([^>]+)>/g,
	/Committer:\s*.*?<([^>]+)>/g,
	/Signed-off-by:\s*.*?<([^>]+)>/g,
	/Co-authored-by:\s*.*?<([^>]+)>/g
];

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

const MAX_REPOS = 6;
const MAX_COMMITS = 5;

export interface ExtractResult {
	username: string;
	repos_scanned: number;
	emails: string[];
	email_count: number;
}

// Returns a random user agent string for request header rotation
function randomAgent(): string {
	return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Checks whether an email address passes validity and domain filters
function isValidEmail(email: string): boolean {
	const lower = email.toLowerCase().trim();
	if (!lower.includes('@')) return false;
	if (lower.startsWith('.') || lower.endsWith('.')) return false;
	if (lower.includes('@.') || lower.includes('..')) return false;

	const domain = lower.split('@')[1];
	if (!domain) return false;
	if (FILTERED_DOMAINS.has(domain)) return false;
	if (lower.startsWith('noreply@') || lower.startsWith('no-reply@')) return false;

	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower);
}

// Extracts email addresses from raw git patch text using header regex patterns
function extractFromPatch(patch: string): Set<string> {
	const emails = new Set<string>();

	for (const pattern of EMAIL_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		let match;
		while ((match = regex.exec(patch)) !== null) {
			const email = match[1].trim().toLowerCase();
			if (isValidEmail(email)) {
				emails.add(email);
			}
		}
	}

	return emails;
}

// Fetches a URL with a rotated user agent and returns the response text
async function fetchPage(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, {
			headers: {
				'User-Agent': randomAgent(),
				'Accept': 'text/html,application/xhtml+xml,*/*'
			}
		});

		if (res.status === 404) return null;
		if (res.status === 429) {
			await new Promise((r) => setTimeout(r, 3000));
			const retry = await fetch(url, {
				headers: { 'User-Agent': randomAgent() }
			});
			if (!retry.ok) return null;
			return retry.text();
		}
		if (!res.ok) return null;

		return res.text();
	} catch {
		return null;
	}
}

// Strips GitHub URL prefixes and whitespace from a username input string
function sanitizeUsername(raw: string): string {
	let cleaned = raw.trim();
	cleaned = cleaned.replace(/^https?:\/\/(www\.)?github\.com\/?/i, '');
	cleaned = cleaned.replace(/\/.*$/, '');
	cleaned = cleaned.replace(/^@/, '');
	return cleaned.trim();
}

// Validates a username against GitHub naming conventions
function isValidUsername(username: string): boolean {
	if (username.length < 1 || username.length > 39) return false;
	if (username.startsWith('-') || username.endsWith('-')) return false;
	if (username.includes('--')) return false;
	return /^[a-zA-Z0-9-]+$/.test(username);
}

// Retrieves public repository names for a GitHub user from their profile page
async function getRepos(username: string): Promise<string[]> {
	const repos: string[] = [];
	const seen = new Set<string>();

	for (let page = 1; page <= 2; page++) {
		const html = await fetchPage(
			`https://github.com/${username}?tab=repositories&page=${page}&type=source`
		);
		if (!html) break;

		const pattern = new RegExp(`href="/${username}/([^/"?#]+)"`, 'gi');
		let match;
		while ((match = pattern.exec(html)) !== null) {
			const name = match[1];
			if (!seen.has(name.toLowerCase()) && !EXCLUDED_PATHS.has(name.toLowerCase())) {
				seen.add(name.toLowerCase());
				repos.push(name);
			}
		}

		if (repos.length >= MAX_REPOS) break;
	}

	return repos.slice(0, MAX_REPOS);
}

// Retrieves commit SHAs for a repository from its commits page
async function getCommitShas(username: string, repo: string): Promise<string[]> {
	const html = await fetchPage(`https://github.com/${username}/${repo}/commits`);
	if (!html) return [];

	const shas = new Set<string>();
	const pattern = new RegExp(`/${username}/${repo}/commit/([a-f0-9]{40})`, 'gi');
	let match;
	while ((match = pattern.exec(html)) !== null) {
		shas.add(match[1]);
		if (shas.size >= MAX_COMMITS) break;
	}

	return Array.from(shas);
}

// Processes a single repository by fetching commit patches and extracting emails
async function processRepo(username: string, repo: string): Promise<Set<string>> {
	const shas = await getCommitShas(username, repo);
	if (shas.length === 0) return new Set();

	const emails = new Set<string>();
	const results = await Promise.all(
		shas.map(async (sha) => {
			const patch = await fetchPage(
				`https://github.com/${username}/${repo}/commit/${sha}.patch`
			);
			return patch ? extractFromPatch(patch) : new Set<string>();
		})
	);

	for (const patchEmails of results) {
		for (const email of patchEmails) {
			emails.add(email);
		}
	}

	return emails;
}

// Orchestrates the full email extraction pipeline for a GitHub user
export async function extractEmails(rawUsername: string): Promise<ExtractResult> {
	const username = sanitizeUsername(rawUsername);

	if (!isValidUsername(username)) {
		throw new Error('invalid github username');
	}

	const profileHtml = await fetchPage(`https://github.com/${username}`);
	if (!profileHtml) {
		throw new Error('user not found');
	}

	const repos = await getRepos(username);
	if (repos.length === 0) {
		return {
			username,
			repos_scanned: 0,
			emails: [],
			email_count: 0
		};
	}

	const repoResults = await Promise.all(repos.map((repo) => processRepo(username, repo)));
	const allEmails = new Set<string>();
	for (const repoEmails of repoResults) {
		for (const email of repoEmails) {
			allEmails.add(email);
		}
	}

	const sorted = Array.from(allEmails).sort();

	return {
		username,
		repos_scanned: repos.length,
		emails: sorted,
		email_count: sorted.length
	};
}
