// Handles email extraction requests by delegating to the GitHub scraper.
import type { RequestHandler } from './$types';
import { extractEmails } from '$lib/scraper';

export const config = {
	maxDuration: 30
};

// Reads an optional integer query param, leaving clamping to the scraper.
function intParam(url: URL, key: string): number | undefined {
	const raw = url.searchParams.get(key);
	if (raw === null) return undefined;
	const n = Number.parseInt(raw, 10);
	return Number.isNaN(n) ? undefined : n;
}

// Validates the query and returns ranked extraction results as JSON.
export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim();

	if (!query) {
		return Response.json({ success: false, error: 'no username provided' });
	}

	try {
		const result = await extractEmails(query, {
			maxRepos: intParam(url, 'repos'),
			maxCommits: intParam(url, 'commits')
		});
		return Response.json({ success: true, ...result });
	} catch (err) {
		return Response.json({
			success: false,
			error: err instanceof Error ? err.message : 'extraction failed'
		});
	}
};
