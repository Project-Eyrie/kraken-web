// Runs a single email→account probe. The supplied token is used only for this
// request (to create, commit to, and delete a throwaway repo) and is never
// logged or persisted.
import type { RequestHandler } from './$types';
import { probe, whoami, validateEmail } from '$lib/github';

export const config = { maxDuration: 30 };

export const POST: RequestHandler = async ({ request }) => {
	let token = '';
	let email = '';
	try {
		({ token = '', email = '' } = (await request.json()) as { token?: string; email?: string });
	} catch {
		return Response.json({ success: false, error: 'invalid request body' });
	}

	token = token.trim();
	email = email.trim().toLowerCase();

	if (!token) return Response.json({ success: false, error: 'no token provided' });
	if (!email) return Response.json({ success: false, error: 'no email provided' });
	if (!validateEmail(email)) {
		return Response.json({ success: false, error: `invalid email: ${email}` });
	}

	try {
		const owner = await whoami(token);
		const result = await probe(token, email, owner);
		return Response.json({ success: true, ...result });
	} catch (err) {
		return Response.json({
			success: false,
			error: err instanceof Error ? err.message : 'probe failed'
		});
	}
};
