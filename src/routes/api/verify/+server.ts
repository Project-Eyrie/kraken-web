// Verifies a supplied GitHub token and returns the operator's login.
// The token is used only for this request and is never stored server-side.
import type { RequestHandler } from './$types';
import { whoami } from '$lib/github';

export const config = { maxDuration: 15 };

export const POST: RequestHandler = async ({ request }) => {
	let token = '';
	try {
		({ token } = (await request.json()) as { token?: string });
	} catch {
		return Response.json({ success: false, error: 'invalid request body' });
	}

	if (!token?.trim()) {
		return Response.json({ success: false, error: 'no token provided' });
	}

	try {
		const login = await whoami(token.trim());
		return Response.json({ success: true, login });
	} catch (err) {
		return Response.json({
			success: false,
			error: err instanceof Error ? err.message : 'token validation failed'
		});
	}
};
