<div align="center">

# Kraken (Web)

> Extract email addresses from GitHub commit history.

[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![In Project Eyrie](https://img.shields.io/badge/IN-PROJECT%20EYRIE-b45309?style=for-the-badge&labelColor=0f172a)](https://github.com/Project-Eyrie)
![CLI](https://img.shields.io/badge/TYPE-CLI-166534?style=for-the-badge&labelColor=0f172a)

</div>

---

## Overview

**Kraken (Web)** is a web-based OSINT tool that extracts public email addresses from GitHub user commit histories. It scrapes commit patch metadata from public repositories and parses git headers to surface email addresses that may not appear on a user's profile.

---

## Features

- **Patch-Based Extraction** — parses From, Author, Committer, Signed-off-by, and Co-authored-by headers from commit patches
- **Intelligent Filtering** — removes noreply addresses, invalid formats, and test domains automatically
- **No Authentication** — operates entirely on public GitHub data without requiring API tokens

---

## How to Use

### About the App

Enter a GitHub username to scan their public repositories for email addresses. The tool fetches commit patches from the most recently active repositories and extracts any email metadata found in the git headers. Results appear in a card with individual copy buttons for each address.

### Interface

| Area | Description |
|------|-------------|
| **Input field** | Accepts a GitHub username or full profile URL |
| **Result card** | Displays username, repository count, and extracted email addresses |
| **Copy buttons** | Individual per-email copy and bulk copy-all functionality |

---

## Theory and Background

### Core Concept

Every git commit embeds author and committer email addresses in its metadata. When commits are pushed to GitHub, this metadata remains accessible through raw patch files at predictable URLs (`github.com/{user}/{repo}/commit/{sha}.patch`). These patches contain standard git headers that can reveal email addresses not shown on a user's public profile.

### Extraction Pipeline

1. Validates and sanitizes the input username (strips URL prefixes, enforces GitHub naming rules)
2. Fetches the user's profile page to confirm the account exists
3. Scrapes up to **2 pages** of the user's repository tab, filtered to source repositories (excludes forks)
4. Selects up to **6 repositories**, prioritized by most recently active
5. For each repository, fetches the commits page and extracts up to **5 commit SHAs**
6. Fetches the raw `.patch` file for each commit (up to **30 patches** total across all repos)
7. Parses 5 email header patterns from each patch: `From`, `Author`, `Committer`, `Signed-off-by`, `Co-authored-by`
8. Filters the aggregated results against 11 blocked domains (`users.noreply.github.com`, `example.com`, `test.com`, `localhost`, etc.) and removes invalid formats
9. Returns deduplicated, sorted email addresses

### Anti-Detection

- Rotates across **8 user agent strings** (Chrome, Firefox, Safari, Edge across platforms)
- Automatic **3-second backoff and retry** on HTTP 429 rate limit responses
- Serverless function timeout set to **30 seconds**

---

## Notes

- **Rate Limiting** — GitHub may rate-limit requests if the tool is used in rapid succession; wait briefly and retry
- **Public Repos Only** — only email addresses from public repositories and commits are accessible
- **Accuracy** — some extracted addresses may belong to co-authors or committers other than the target user
- **Scope** — scans up to 6 repositories and 5 commits per repository, producing a maximum of 30 patch fetches per lookup

---

<div align="center">
  Part of Project Eyrie — by <a href="https://notalex.sh">notalex.sh</a>
</div>
