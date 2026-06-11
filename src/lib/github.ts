// Resolves a GitHub account from an email by exploiting commit-author linking:
// a commit authored with the target email, pushed to a throwaway private repo,
// gets server-side linked by GitHub to the account that owns that verified
// email. The repo is deleted immediately after. Port of the reversekraken CLI.

const API = 'https://api.github.com';
const API_VER = '2022-11-28';

const FIRST_NAMES = ['John', 'Joe', 'Fred'];
const LAST_NAMES = ['Doe', 'Bloggs', 'Nurk', 'Public'];

export interface ProbeResult {
	email: string;
	github_username: string | null;
	display_name: string | null;
	profile_url: string | null;
	bio: string | null;
	location: string | null;
	company: string | null;
	public_repos: number | null;
	followers: number | null;
	linked: boolean;
}

interface GitHubUser {
	login: string;
	name?: string | null;
	html_url?: string;
	bio?: string | null;
	location?: string | null;
	company?: string | null;
	public_repos?: number;
	followers?: number;
}

// Authenticated GitHub API request. Throws a readable error on a 4xx/5xx.
async function api<T = unknown>(
	token: string,
	method: string,
	path: string,
	body?: unknown
): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': API_VER,
			Authorization: `Bearer ${token}`,
			'User-Agent': 'reversekraken-web/1.0',
			...(body ? { 'Content-Type': 'application/json' } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});

	if (res.status >= 400) {
		let message: string;
		try {
			const data = (await res.json()) as { message?: string };
			message = data.message ?? `${res.status}`;
		} catch {
			message = (await res.text()) || String(res.status);
		}
		throw new Error(`github api ${res.status}: ${message}`);
	}

	if (res.status === 204 || res.headers.get('content-length') === '0') {
		return {} as T;
	}
	const text = await res.text();
	return (text ? JSON.parse(text) : {}) as T;
}

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function randomName(): string {
	return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

// A random ISO timestamp within the past `days` days.
function randomDate(days = 30): string {
	const now = Date.now();
	const offset = Math.floor(Math.random() * days * 24 * 60 * 60 * 1000);
	return new Date(now - offset).toISOString();
}

function randomRepoName(): string {
	const suffix = Math.random().toString(36).slice(2, 10);
	return `tmp-probe-${Math.floor(Date.now() / 1000)}-${suffix}`;
}

export function validateEmail(email: string): boolean {
	const at = email.indexOf('@');
	return at > 0 && email.slice(at + 1).includes('.');
}

function base64(input: string): string {
	// Buffer is available in the Node serverless runtime used by adapter-vercel.
	return Buffer.from(input, 'utf-8').toString('base64');
}

// Returns the login of the account that owns the supplied token.
export async function whoami(token: string): Promise<string> {
	const user = await api<GitHubUser>(token, 'GET', '/user');
	return user.login;
}

// Runs a single email→account probe under the operator's account.
export async function probe(token: string, email: string, owner: string): Promise<ProbeResult> {
	const repo = randomRepoName();

	await api(token, 'POST', '/user/repos', {
		name: repo,
		private: true,
		auto_init: true,
		description: 'Temporary probe'
	});

	try {
		const result = await api<{ commit: { sha: string } }>(
			token,
			'PUT',
			`/repos/${owner}/${repo}/contents/probe.txt`,
			{
				message: `probe: ${email}`,
				content: base64(`probe ${email}`),
				author: { name: randomName(), email, date: randomDate() },
				committer: { name: 'Probe', email: 'probe@local', date: randomDate() }
			}
		);
		const sha = result.commit.sha;

		// Poll until GitHub attaches a linked author, or we give up.
		let username = '';
		for (let i = 0; i < 8; i++) {
			const data = await api<{ author?: { login?: string } | null }>(
				token,
				'GET',
				`/repos/${owner}/${repo}/commits/${sha}`
			);
			const login = data.author?.login;
			if (login) {
				username = login;
				break;
			}
			await new Promise((r) => setTimeout(r, 1000));
		}

		const profile = username ? await api<GitHubUser>(token, 'GET', `/users/${username}`) : null;

		return {
			email,
			github_username: username || null,
			display_name: profile?.name ?? null,
			profile_url: profile?.html_url ?? null,
			bio: profile?.bio ?? null,
			location: profile?.location ?? null,
			company: profile?.company ?? null,
			public_repos: profile?.public_repos ?? null,
			followers: profile?.followers ?? null,
			linked: Boolean(username)
		};
	} finally {
		// Always clean up the throwaway repo, even if the probe threw.
		try {
			await api(token, 'DELETE', `/repos/${owner}/${repo}`);
		} catch {
			/* best-effort cleanup */
		}
	}
}
