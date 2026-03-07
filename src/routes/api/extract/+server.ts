// Handles email extraction requests by delegating to the GitHub scraper
import type { RequestHandler } from './$types';
import { extractEmails } from '$lib/scraper';

export const config = {
	maxDuration: 30
};

// Validates the query parameter and returns extraction results as JSON
export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim();

	if (!query) {
		return Response.json({ success: false, error: 'no username provided' });
	}

	try {
		const result = await extractEmails(query);
		return Response.json({ success: true, ...result });
	} catch (err) {
		return Response.json({
			success: false,
			error: err instanceof Error ? err.message : 'extraction failed'
		});
	}
};
