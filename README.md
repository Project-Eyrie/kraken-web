<div align="center">

# Kraken

> GitHub identity intelligence — resolve emails from a username, or the account behind an email.

[![In Project Eyrie](https://img.shields.io/badge/IN-PROJECT%20EYRIE-334155?style=for-the-badge&labelColor=020617)](https://github.com/Project-Eyrie)
![Type](https://img.shields.io/badge/TYPE-WEB-3f6212?style=for-the-badge&labelColor=020617)

</div>

---

## Overview

**Kraken** combines two OSINT directions into one web tool, switchable from a single toggle:

- **`username → emails`** — scrapes public git patch metadata from a user's commit history and ranks each address by how closely it matches the target handle. No authentication; public repositories only.
- **`email → account`** — probes GitHub's commit-author linking to resolve the account behind an email, using your own token. Creates a throwaway private repo, authors a commit with the target email, reads back the linked profile, and deletes the repo.

Built with SvelteKit (Svelte 5) + Tailwind v4, deployed on Vercel.

---

## Directions

### username → emails (no auth)

Pick a scan depth — **fast** (3×3), **default** (6×5), or **slow** (10×8) — enter a username, and Kraken fetches commit patches across the user's recent repos, parses the git author/committer headers, filters noise, and returns deduplicated addresses ranked **likely / possible / unlikely** against the handle.

### email → account (bring-your-own-token)

Paste a GitHub Personal Access Token (`repo` + `delete_repo` scope); it's verified and the operator login is shown. Enter a target email and probe. The token is sent per request and **never stored on the server**; "remember in this browser only" keeps it in `localStorage` on your device, and "change" clears it. Prefer a short-lived token and revoke it when done.

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
    scraper.ts        forward: scrape + filter commit-patch emails
    match.ts          forward: rank addresses against the handle
    github.ts         reverse: commit-author probe
  routes/
    +page.svelte      combined console (direction toggle)
    api/extract/      forward endpoint
    api/probe/        reverse probe endpoint
    api/verify/       reverse token-verify endpoint
```

---

## Privacy & scope

- **Forward** reads only public commit metadata; ranking reflects handle/email similarity, not confirmed ownership — surfaced addresses may belong to co-authors.
- **Reverse** returns only public profile data and is attributable to the operator's own rate-limited account. Anyone can opt out by enabling *Keep my email addresses private* at <https://github.com/settings/emails>.

---

<div align="center">
  Part of Project Eyrie — by <a href="https://notalex.sh">notalex.sh</a>
</div>
