<div align="center">

# Kraken

> GitHub identity intelligence: resolve emails from a username, or the account behind an email.

</div>

---

## Overview

**Kraken** combines two OSINT directions into one web tool, switchable from a single toggle:

- **find emails** (username input): scrapes public git patch metadata from a user's commit history and ranks each address by how closely it matches the target handle. No authentication; public repositories only.
- **find account** (email input): probes GitHub's commit-author linking to resolve the account behind an email, using your own token. Creates a throwaway private repo, authors a commit with the target email, reads back the linked profile, and deletes the repo.

Built with SvelteKit (Svelte 5) and Tailwind v4, deployed on Vercel.

---

## Directions

### find emails (no auth)

Pick a scan depth (**fast** 3x3, **default** 6x5, or **slow** 10x8), enter a username, and Kraken fetches commit patches across the user's recent repos, parses the git author and committer headers, filters noise, and returns deduplicated addresses ranked likely / possible / unlikely against the handle.

### find account (bring-your-own-token)

Paste a GitHub Personal Access Token (`repo` + `delete_repo` scope); it gets verified and the operator login is shown. Enter a target email and probe. The token is sent per request and never stored on the server. "Remember in this browser only" keeps it in `localStorage` on your device, and "change" clears it. Prefer a short-lived token and revoke it when done.

---

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # production build (Vercel adapter)
```

---

## Structure

```
src/
  lib/
    scraper.ts        find emails: scrape and filter commit-patch emails
    match.ts          find emails: rank addresses against the handle
    github.ts         find account: commit-author probe
  routes/
    +page.svelte      combined console (direction toggle)
    api/extract/      find-emails endpoint
    api/probe/        find-account probe endpoint
    api/verify/       find-account token-verify endpoint
```

---

## Privacy and scope

- **find emails** reads only public commit metadata. Ranking reflects handle/email similarity, not confirmed ownership; surfaced addresses may belong to co-authors.
- **find account** returns only public profile data and is attributable to the operator's own rate-limited account. Anyone can opt out by enabling *Keep my email addresses private* at <https://github.com/settings/emails>.
