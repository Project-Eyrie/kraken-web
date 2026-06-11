<script lang="ts">
	// Combined Kraken console. Two directions share one shell:
	//  · forward (username → emails): scrapes public commit patches, ranks matches
	//  · reverse (email → account): probes commit-author linking with your token
	import { onMount } from 'svelte';
	import type { ExtractResult, MatchTier, ProbeResult } from '$lib';

	type Direction = 'forward' | 'reverse';
	const DIRECTIONS: Direction[] = ['forward', 'reverse'];
	const DIRECTION_LABELS: Record<Direction, string> = {
		forward: 'username → emails',
		reverse: 'email → account'
	};

	// Forward scan presets — each does progressively more work.
	const MODES = {
		fast: { repos: 3, commits: 3, note: 'quick sweep' },
		default: { repos: 6, commits: 5, note: 'balanced' },
		slow: { repos: 10, commits: 8, note: 'deep scan' }
	} as const;
	type Mode = keyof typeof MODES;
	const MODE_ORDER: Mode[] = ['fast', 'default', 'slow'];

	// Per-direction readout stages mirror each real server pipeline.
	const FORWARD_STAGES = [
		'resolving target',
		'enumerating repositories',
		'reading commit history',
		'parsing patch metadata',
		'ranking likely matches',
		'surfacing addresses'
	] as const;
	const REVERSE_STAGES = [
		'authenticating',
		'creating temporary repository',
		'authoring probe commit',
		'waiting for github to link',
		'resolving profile',
		'cleaning up'
	] as const;
	const HOLD_STAGE = 3; // both pipelines hold on their variable-time step

	const TOKEN_KEY = 'rk_token';
	const TOKEN_NEW_URL =
		'https://github.com/settings/tokens/new?description=kraken&scopes=repo,delete_repo';

	// ----- shared state -----
	let direction = $state<Direction>('forward');
	let loading = $state(false);
	let error = $state('');
	let copied = $state('');
	let stage = $state(0);
	let stageTimer: ReturnType<typeof setInterval> | null = null;
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	// ----- forward state -----
	let query = $state('');
	let mode = $state<Mode>('default');
	let extractResult: ExtractResult | null = $state(null);
	let displayFound = $state(0);

	// ----- reverse state -----
	let token = $state('');
	let remember = $state(false);
	let operator = $state('');
	let editingToken = $state(true);
	let verifying = $state(false);
	let email = $state('');
	let probeResult: ProbeResult | null = $state(null);

	const directionIndex = $derived(DIRECTIONS.indexOf(direction));
	const modeIndex = $derived(MODE_ORDER.indexOf(mode));
	const depth = $derived(MODES[mode]);
	const patchBudget = $derived(depth.repos * depth.commits);
	const STAGES = $derived(direction === 'forward' ? FORWARD_STAGES : REVERSE_STAGES);

	const canExtract = $derived(query.trim().length > 0 && !loading);
	const canVerify = $derived(token.trim().length > 0 && !verifying);
	const canProbe = $derived(
		Boolean(operator) && email.trim().length > 0 && !loading && !editingToken
	);

	const statusLabel = $derived(
		loading
			? direction === 'forward'
				? 'scanning'
				: 'probing'
			: error
				? 'error'
				: direction === 'reverse' && !operator
					? 'no token'
					: 'ready'
	);

	const tally = $derived.by(() => {
		const t = { likely: 0, possible: 0, unlikely: 0 };
		if (extractResult) for (const m of extractResult.emails) t[m.tier] += 1;
		return t;
	});

	const stats = $derived.by(() => {
		if (!probeResult) return '';
		const parts: string[] = [];
		if (probeResult.public_repos != null) parts.push(`${probeResult.public_repos} repos`);
		if (probeResult.followers != null) parts.push(`${probeResult.followers} followers`);
		return parts.join(' · ');
	});

	onMount(() => {
		const saved = localStorage.getItem(TOKEN_KEY);
		if (saved) {
			token = saved;
			remember = true;
			verifyToken();
		}
	});

	// Count the forward "found" stat up from zero on a new result.
	$effect(() => {
		const target = extractResult?.email_count ?? 0;
		const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		if (target === 0 || reduce) {
			displayFound = target;
			return;
		}
		let raf = 0;
		const start = performance.now();
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / 650);
			displayFound = Math.round(target * (1 - Math.pow(1 - t, 3)));
			if (t < 1) raf = requestAnimationFrame(tick);
		};
		displayFound = 0;
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	function setDirection(d: Direction) {
		if (loading || d === direction) return;
		direction = d;
		error = '';
	}

	function startStages() {
		stage = 0;
		stageTimer = setInterval(() => {
			if (stage < HOLD_STAGE) stage += 1;
		}, 520);
	}
	function stopStages() {
		if (stageTimer) {
			clearInterval(stageTimer);
			stageTimer = null;
		}
	}

	// ----- forward: extract -----
	function handleQueryKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && canExtract) extract();
	}
	async function extract() {
		if (!canExtract) return;
		loading = true;
		error = '';
		extractResult = null;
		startStages();
		try {
			const params = new URLSearchParams({
				q: query.trim(),
				repos: String(depth.repos),
				commits: String(depth.commits)
			});
			const res = await fetch(`/api/extract?${params}`);
			const data = await res.json();
			if (data.success) {
				stage = FORWARD_STAGES.length - 1;
				extractResult = {
					username: data.username,
					repos_scanned: data.repos_scanned,
					max_repos: data.max_repos,
					max_commits: data.max_commits,
					emails: data.emails,
					email_count: data.email_count
				};
			} else {
				error = data.error || 'extraction failed';
			}
		} catch {
			error = 'failed to reach server';
		} finally {
			stopStages();
			loading = false;
		}
	}

	// ----- reverse: token + probe -----
	function handleTokenKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && canVerify) verifyToken();
	}
	function handleEmailKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && canProbe) probe();
	}
	async function verifyToken() {
		if (!canVerify) return;
		verifying = true;
		error = '';
		try {
			const res = await fetch('/api/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: token.trim() })
			});
			const data = await res.json();
			if (data.success) {
				operator = data.login;
				editingToken = false;
				if (remember) localStorage.setItem(TOKEN_KEY, token.trim());
				else localStorage.removeItem(TOKEN_KEY);
			} else {
				operator = '';
				error = data.error || 'token validation failed';
			}
		} catch {
			error = 'failed to reach server';
		} finally {
			verifying = false;
		}
	}
	function forgetToken() {
		token = '';
		operator = '';
		remember = false;
		editingToken = true;
		probeResult = null;
		localStorage.removeItem(TOKEN_KEY);
	}
	async function probe() {
		if (!canProbe) return;
		loading = true;
		error = '';
		probeResult = null;
		startStages();
		try {
			const res = await fetch('/api/probe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: token.trim(), email: email.trim() })
			});
			const data = await res.json();
			if (data.success) {
				stage = REVERSE_STAGES.length - 1;
				probeResult = {
					email: data.email,
					github_username: data.github_username,
					display_name: data.display_name,
					profile_url: data.profile_url,
					bio: data.bio,
					location: data.location,
					company: data.company,
					public_repos: data.public_repos,
					followers: data.followers,
					linked: data.linked
				};
			} else {
				error = data.error || 'probe failed';
			}
		} catch {
			error = 'failed to reach server';
		} finally {
			stopStages();
			loading = false;
		}
	}

	// ----- shared helpers -----
	async function copyText(value: string, key: string) {
		try {
			await navigator.clipboard.writeText(value);
			copied = key;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (copied = ''), 1600);
		} catch {
			/* clipboard unavailable */
		}
	}
	function copyAll() {
		if (extractResult) copyText(extractResult.emails.map((m) => m.address).join('\n'), '__all__');
	}
	function tierStyle(tier: MatchTier): { glyph: string; color: string } {
		if (tier === 'likely') return { glyph: '●', color: 'var(--signal)' };
		if (tier === 'possible') return { glyph: '◐', color: 'var(--probe)' };
		return { glyph: '○', color: 'var(--faint)' };
	}
</script>

<svelte:head>
	<title>kraken — github identity intelligence</title>
	<meta
		name="description"
		content="Resolve emails from a GitHub username, or the GitHub account behind an email."
	/>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<main class="min-h-screen flex flex-col items-center px-5 py-16 sm:py-24">
	<div class="w-full max-w-xl" style="font-family: var(--font-mono)">
		<!-- Header -->
		<header class="anim-rise flex items-end justify-between">
			<div>
				<h1
					class="text-4xl font-bold tracking-tight leading-none"
					style="font-family: var(--font-display); color: var(--text)"
				>
					kraken<span class="cursor-blink" style="color: var(--signal)">_</span>
				</h1>
				<p class="mt-2 text-[11px] uppercase tracking-[0.25em]" style="color: var(--muted)">
					github identity intelligence
				</p>
			</div>
			<div class="flex items-center gap-2 pb-1">
				<span class="relative flex h-2 w-2">
					{#if loading}
						<span class="absolute inset-0 rounded-full live-ring" style="background: var(--probe)"
						></span>
					{/if}
					<span
						class="h-2 w-2 rounded-full {loading ? 'status-dot' : ''}"
						style="background: {loading
							? 'var(--probe)'
							: error
								? 'var(--danger)'
								: direction === 'reverse' && !operator
									? 'var(--faint)'
									: 'var(--signal)'}"
					></span>
				</span>
				<span class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--muted)">
					{statusLabel}
				</span>
			</div>
		</header>

		<!-- Direction toggle -->
		<section class="anim-rise mt-8" style="animation-delay: 40ms">
			<div
				class="segmented w-full"
				style="--idx: {directionIndex}; --cols: 2"
				role="group"
				aria-label="direction"
			>
				<span class="seg-thumb" aria-hidden="true"></span>
				{#each DIRECTIONS as d}
					<button
						class="seg"
						aria-pressed={direction === d}
						disabled={loading}
						onclick={() => setDirection(d)}>{DIRECTION_LABELS[d]}</button
					>
				{/each}
			</div>
		</section>

		{#if direction === 'forward'}
			<!-- Forward: username → emails -->
			<section class="anim-rise-sm mt-4">
				<div class="flex gap-2.5">
					<label class="field flex-1 flex items-center rounded-lg px-3.5">
						<span class="select-none text-sm pr-2" style="color: var(--signal)">&gt;</span>
						<input
							type="text"
							bind:value={query}
							onkeydown={handleQueryKeydown}
							placeholder="github username or profile url"
							autocapitalize="off"
							autocomplete="off"
							autocorrect="off"
							spellcheck="false"
							class="field-input w-full bg-transparent py-3 text-sm outline-none"
							style="color: var(--text)"
						/>
					</label>
					<button
						onclick={extract}
						disabled={!canExtract}
						class="btn-run rounded-lg px-5 text-sm font-bold tracking-wide"
						style="font-family: var(--font-display)"
					>
						{loading ? '···' : 'extract'}
					</button>
				</div>

				<!-- Scan mode presets -->
				<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
					<span class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--faint)">mode</span>
					<div class="segmented" style="--idx: {modeIndex}; --cols: 3" role="group" aria-label="scan mode">
						<span class="seg-thumb" aria-hidden="true"></span>
						{#each MODE_ORDER as m}
							<button
								class="seg"
								aria-pressed={mode === m}
								disabled={loading}
								onclick={() => (mode = m)}>{m}</button
							>
						{/each}
					</div>
					<span class="text-[10px] tabular-nums" style="color: var(--faint)">
						{depth.note} · {depth.repos}×{depth.commits} · ≤ {patchBudget} patches{patchBudget > 60
							? ' · may rate-limit'
							: ''}
					</span>
				</div>
			</section>
		{:else}
			<!-- Reverse: email → account -->
			<section class="anim-rise-sm mt-4">
				{#if editingToken}
					<div class="panel rounded-xl p-4">
						<div class="flex items-center justify-between mb-2">
							<p class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--muted)">
								github token
							</p>
							<a class="link-accent text-[10px] uppercase tracking-[0.15em]" href={TOKEN_NEW_URL}
								target="_blank" rel="noreferrer">create one ↗</a
							>
						</div>
						<div class="flex gap-2.5">
							<label class="field flex-1 flex items-center rounded-lg px-3.5">
								<span class="select-none text-sm pr-2" style="color: var(--signal)">#</span>
								<input
									type="password"
									bind:value={token}
									onkeydown={handleTokenKeydown}
									placeholder="ghp_… (scopes: repo, delete_repo)"
									autocapitalize="off"
									autocomplete="off"
									autocorrect="off"
									spellcheck="false"
									class="field-input w-full bg-transparent py-3 text-sm outline-none"
									style="color: var(--text)"
								/>
							</label>
							<button
								onclick={verifyToken}
								disabled={!canVerify}
								class="btn-run rounded-lg px-5 text-sm font-bold tracking-wide"
								style="font-family: var(--font-display)"
							>
								{verifying ? '···' : 'verify'}
							</button>
						</div>
						<label class="flex items-center gap-2 mt-3 text-[11px] cursor-pointer select-none"
							style="color: var(--muted)"
						>
							<input type="checkbox" bind:checked={remember} class="accent-[color:var(--signal)]" />
							remember in this browser only
						</label>
						<p class="text-[10px] mt-2 leading-relaxed" style="color: var(--faint)">
							Your token is sent per request and never stored on the server. It needs repo +
							delete_repo scope — a powerful token, so prefer a short-lived one and revoke it when
							done.
						</p>
					</div>
				{:else}
					<div class="panel rounded-xl px-4 py-3 flex items-center justify-between">
						<p class="text-sm truncate" style="color: var(--text)">
							<span style="color: var(--signal)">✓</span> authenticated as
							<span class="font-bold">{operator}</span>
						</p>
						<button
							onclick={forgetToken}
							class="ghost-btn shrink-0 text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded"
							style="color: var(--muted)">change</button
						>
					</div>
				{/if}

				<div class="flex gap-2.5 mt-3">
					<label class="field flex-1 flex items-center rounded-lg px-3.5">
						<span class="select-none text-sm pr-2" style="color: var(--signal)">&gt;</span>
						<input
							type="email"
							bind:value={email}
							onkeydown={handleEmailKeydown}
							disabled={!operator}
							placeholder={operator ? 'target email address' : 'verify a token first'}
							autocapitalize="off"
							autocomplete="off"
							autocorrect="off"
							spellcheck="false"
							class="field-input w-full bg-transparent py-3 text-sm outline-none disabled:opacity-50"
							style="color: var(--text)"
						/>
					</label>
					<button
						onclick={probe}
						disabled={!canProbe}
						class="btn-run rounded-lg px-5 text-sm font-bold tracking-wide"
						style="font-family: var(--font-display)"
					>
						{loading ? '···' : 'probe'}
					</button>
				</div>
			</section>
		{/if}

		<!-- Live readout (shared) -->
		{#if loading}
			<section class="anim-rise-sm mt-7 panel rounded-xl overflow-hidden">
				<div class="scan-track h-px" style="background: var(--line)"></div>
				<ol class="p-5 space-y-2.5">
					{#each STAGES as label, i}
						<li class="flex items-center gap-3 text-[13px]">
							<span
								class="w-4 text-center"
								style="color: {i < stage ? 'var(--probe)' : i === stage ? 'var(--signal)' : 'var(--faint)'}"
							>
								{i < stage ? '✓' : i === stage ? '▸' : '·'}
							</span>
							<span style="color: {i <= stage ? 'var(--text)' : 'var(--faint)'}">
								{label}{#if i === stage}<span class="cursor-blink" style="color: var(--probe)">_</span>{/if}
							</span>
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		<!-- Error (shared) -->
		{#if error}
			<section
				class="anim-rise-sm mt-7 panel rounded-xl p-5"
				style="border-color: rgba(240,99,99,0.3)"
			>
				<p class="text-[11px] uppercase tracking-[0.2em] mb-1.5" style="color: var(--danger)">
					{direction === 'forward' ? 'extraction halted' : 'probe halted'}
				</p>
				<p class="text-sm break-words" style="color: var(--text)">{error}</p>
			</section>
		{/if}

		<!-- Forward results -->
		{#if direction === 'forward' && extractResult && !loading}
			<section class="anim-rise-sm mt-7 panel rounded-xl overflow-hidden">
				<div class="grid grid-cols-3">
					<div class="p-4">
						<p class="text-[10px] uppercase tracking-[0.2em] mb-1.5" style="color: var(--muted)">
							target
						</p>
						<p class="text-sm truncate" style="color: var(--text)">{extractResult.username}</p>
					</div>
					<div class="p-4 border-l" style="border-color: var(--line-soft)">
						<p class="text-[10px] uppercase tracking-[0.2em] mb-1.5" style="color: var(--muted)">
							scanned
						</p>
						<p class="text-sm" style="color: var(--text)">
							{extractResult.repos_scanned}r · {extractResult.max_commits}c
						</p>
					</div>
					<div class="p-4 border-l" style="border-color: var(--line-soft)">
						<p class="text-[10px] uppercase tracking-[0.2em] mb-1.5" style="color: var(--muted)">
							found
						</p>
						<p class="text-sm font-bold tabular-nums" style="color: var(--signal)">{displayFound}</p>
					</div>
				</div>

				{#if extractResult.emails.length > 0}
					<div class="p-4 border-t" style="border-color: var(--line)">
						<div class="flex items-center justify-between mb-3">
							<p class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--muted)">
								{tally.likely} likely · {tally.possible} possible · {tally.unlikely} unlikely
							</p>
							<button
								onclick={copyAll}
								class="ghost-btn text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded"
								style="color: {copied === '__all__' ? 'var(--probe)' : 'var(--muted)'}"
							>
								{copied === '__all__' ? 'copied ✓' : 'copy all'}
							</button>
						</div>
						<ul class="space-y-1">
							{#each extractResult.emails as m, i (m.address)}
								{@const ts = tierStyle(m.tier)}
								<li
									class="row-email anim-rise-sm rounded-md px-3 py-2.5 group"
									style="animation-delay: {i * 45}ms"
								>
									<div class="flex items-center justify-between gap-3">
										<div class="flex items-center gap-2.5 min-w-0">
											<span
												class="shrink-0 text-xs {i === 0 && m.tier === 'likely' ? 'pulse-marker' : ''}"
												style="color: {ts.color}"
												title={m.tier}>{ts.glyph}</span
											>
											<span class="text-sm truncate" style="color: var(--text)">{m.address}</span>
											{#if i === 0 && m.tier === 'likely'}
												<span
													class="shrink-0 text-[9px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded"
													style="color: var(--signal); border: 1px solid rgba(var(--signal-rgb), 0.4)"
													>best guess</span
												>
											{/if}
										</div>
										<div class="flex items-center gap-3 shrink-0">
											<span class="text-[11px] tabular-nums" style="color: var(--muted)">{m.score}%</span>
											<button
												onclick={() => copyText(m.address, m.address)}
												class="ghost-btn text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100"
												style="color: {copied === m.address ? 'var(--probe)' : 'var(--muted)'}"
											>
												{copied === m.address ? 'copied ✓' : 'copy'}
											</button>
										</div>
									</div>
									<p class="text-[11px] mt-1 pl-[26px]" style="color: var(--faint)">{m.reason}</p>
									<div class="meter mt-2 ml-[26px]">
										<span
											class="meter-fill"
											style="--frac: {m.score / 100}; background: {ts.color}; animation-delay: {i * 45 + 140}ms"
										></span>
									</div>
								</li>
							{/each}
						</ul>
					</div>
				{:else}
					<div class="p-6 text-center border-t" style="border-color: var(--line)">
						<p class="text-sm" style="color: var(--text)">no public addresses surfaced</p>
						<p class="text-xs mt-1.5" style="color: var(--muted)">
							try the slow mode, or this user exposes no readable email metadata.
						</p>
					</div>
				{/if}
			</section>
		{/if}

		<!-- Reverse results -->
		{#if direction === 'reverse' && probeResult && !loading}
			{#if probeResult.linked}
				<section class="anim-rise-sm mt-7 panel rounded-xl overflow-hidden">
					<div class="p-5 flex items-center gap-4">
						<div
							class="avatar-in shrink-0 grid place-items-center h-14 w-14 rounded-lg text-2xl font-bold"
							style="font-family: var(--font-display); background: rgba(var(--signal-rgb), 0.12); border: 1px solid rgba(var(--signal-rgb), 0.45); color: var(--signal)"
						>
							{(probeResult.display_name || probeResult.github_username || '?').charAt(0).toUpperCase()}
						</div>
						<div class="min-w-0">
							{#if probeResult.display_name}
								<p class="text-base font-bold truncate" style="color: var(--text)">
									{probeResult.display_name}
								</p>
							{/if}
							<p class="text-sm truncate" style="color: var(--signal)">@{probeResult.github_username}</p>
							{#if stats}
								<p class="text-[11px] mt-0.5 tabular-nums" style="color: var(--muted)">{stats}</p>
							{/if}
						</div>
					</div>

					<dl class="border-t" style="border-color: var(--line)">
						<div class="flex items-start gap-4 px-5 py-3">
							<dt class="w-24 shrink-0 text-[10px] uppercase tracking-[0.2em] pt-0.5" style="color: var(--muted)">
								email
							</dt>
							<dd class="flex-1 min-w-0 flex items-center justify-between gap-3 group">
								<span class="text-sm truncate" style="color: var(--text)">{probeResult.email}</span>
								<button
									onclick={() => copyText(probeResult?.email ?? '', 'email')}
									class="ghost-btn shrink-0 text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100"
									style="color: {copied === 'email' ? 'var(--probe)' : 'var(--muted)'}"
								>
									{copied === 'email' ? 'copied ✓' : 'copy'}
								</button>
							</dd>
						</div>

						{#if probeResult.profile_url}
							<div class="flex items-start gap-4 px-5 py-3 border-t" style="border-color: var(--line-soft)">
								<dt class="w-24 shrink-0 text-[10px] uppercase tracking-[0.2em] pt-0.5" style="color: var(--muted)">
									profile
								</dt>
								<dd class="flex-1 min-w-0 flex items-center justify-between gap-3 group">
									<a class="link-accent text-sm truncate" href={probeResult.profile_url} target="_blank"
										rel="noreferrer">{probeResult.profile_url}</a
									>
									<button
										onclick={() => copyText(probeResult?.profile_url ?? '', 'profile')}
										class="ghost-btn shrink-0 text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100"
										style="color: {copied === 'profile' ? 'var(--probe)' : 'var(--muted)'}"
									>
										{copied === 'profile' ? 'copied ✓' : 'copy'}
									</button>
								</dd>
							</div>
						{/if}

						{#if probeResult.company}
							<div class="flex items-start gap-4 px-5 py-3 border-t" style="border-color: var(--line-soft)">
								<dt class="w-24 shrink-0 text-[10px] uppercase tracking-[0.2em] pt-0.5" style="color: var(--muted)">
									company
								</dt>
								<dd class="text-sm" style="color: var(--text)">{probeResult.company}</dd>
							</div>
						{/if}

						{#if probeResult.location}
							<div class="flex items-start gap-4 px-5 py-3 border-t" style="border-color: var(--line-soft)">
								<dt class="w-24 shrink-0 text-[10px] uppercase tracking-[0.2em] pt-0.5" style="color: var(--muted)">
									location
								</dt>
								<dd class="text-sm" style="color: var(--text)">{probeResult.location}</dd>
							</div>
						{/if}

						{#if probeResult.bio}
							<div class="flex items-start gap-4 px-5 py-3 border-t" style="border-color: var(--line-soft)">
								<dt class="w-24 shrink-0 text-[10px] uppercase tracking-[0.2em] pt-0.5" style="color: var(--muted)">
									bio
								</dt>
								<dd class="text-sm leading-relaxed" style="color: var(--text)">{probeResult.bio}</dd>
							</div>
						{/if}
					</dl>

					<div class="px-5 py-3 border-t" style="border-color: var(--line)">
						<p class="text-[11px]" style="color: var(--signal)">
							✓ account linked to {probeResult.email}
						</p>
					</div>
				</section>
			{:else}
				<section class="anim-rise-sm mt-7 panel rounded-xl p-6 text-center">
					<p class="text-sm" style="color: var(--text)">no github account linked</p>
					<p class="text-xs mt-1.5 leading-relaxed" style="color: var(--muted)">
						{probeResult.email} isn't tied to a GitHub account, or the owner has email privacy enabled.
					</p>
				</section>
			{/if}
		{/if}

		<!-- Footer -->
		<footer
			class="anim-rise mt-14 pt-6 border-t"
			style="border-color: var(--line-soft); animation-delay: 120ms"
		>
			{#if direction === 'forward'}
				<p class="text-[11px] leading-relaxed" style="color: var(--faint)">
					Reads public git patch metadata from GitHub commit history and ranks each address by how
					closely it matches the target handle. No authentication, public repositories only. Ranking
					reflects handle/email similarity, not confirmed ownership.
				</p>
			{:else}
				<p class="text-[11px] leading-relaxed" style="color: var(--faint)">
					Creates a throwaway private repo under your own account, authors a commit with the target
					email, and reads back whether GitHub links it to a profile — then deletes the repo. Only
					public profile data is returned. Anyone can prevent this by enabling
					<a class="link-accent" href="https://github.com/settings/emails" target="_blank"
						rel="noreferrer">keep my email addresses private</a
					> in their GitHub settings.
				</p>
			{/if}
			<p class="text-[10px] uppercase tracking-[0.2em] mt-4" style="color: var(--faint)">
				part of project eyrie
			</p>
		</footer>
	</div>
</main>
