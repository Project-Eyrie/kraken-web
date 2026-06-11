<script lang="ts">
	// Console for the Kraken email-extraction tool: input, scan-mode presets,
	// live probe readout, and ranked results.
	import type { ExtractResult, MatchTier } from '$lib';

	// Scan presets — each does progressively more work (and takes longer).
	const MODES = {
		fast: { repos: 3, commits: 3, note: 'quick sweep' },
		default: { repos: 6, commits: 5, note: 'balanced' },
		slow: { repos: 10, commits: 8, note: 'deep scan' }
	} as const;
	type Mode = keyof typeof MODES;
	const MODE_ORDER: Mode[] = ['fast', 'default', 'slow'];

	// Stages mirror the real server pipeline so the readout reflects actual work.
	const STAGES = [
		'resolving target',
		'enumerating repositories',
		'reading commit history',
		'parsing patch metadata',
		'ranking likely matches',
		'surfacing addresses'
	] as const;
	const HOLD_STAGE = 3; // hold on "parsing" until the response lands

	let query = $state('');
	let mode = $state<Mode>('default');
	let loading = $state(false);
	let error = $state('');
	let result: ExtractResult | null = $state(null);
	let copied = $state('');
	let stage = $state(0);
	let displayFound = $state(0); // animated count-up of the found total

	let stageTimer: ReturnType<typeof setInterval> | null = null;
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	const canRun = $derived(query.trim().length > 0 && !loading);
	const modeIndex = $derived(MODE_ORDER.indexOf(mode));
	const depth = $derived(MODES[mode]);
	const patchBudget = $derived(depth.repos * depth.commits);

	// Tier breakdown for the results summary line.
	const tally = $derived.by(() => {
		const t = { likely: 0, possible: 0, unlikely: 0 };
		if (result) for (const m of result.emails) t[m.tier] += 1;
		return t;
	});

	// Count the "found" stat up from zero whenever a new result lands.
	$effect(() => {
		const target = result?.email_count ?? 0;
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

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && canRun) extract();
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

	async function extract() {
		if (!canRun) return;

		loading = true;
		error = '';
		result = null;
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
				stage = STAGES.length - 1; // surfaced
				result = {
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

	async function copyText(value: string, key: string) {
		try {
			await navigator.clipboard.writeText(value);
			copied = key;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (copied = ''), 1600);
		} catch {
			/* clipboard unavailable — ignore */
		}
	}
	function copyAll() {
		if (result) copyText(result.emails.map((m) => m.address).join('\n'), '__all__');
	}

	// Maps a match tier to its marker glyph and accent colour.
	function tierStyle(tier: MatchTier): { glyph: string; color: string } {
		if (tier === 'likely') return { glyph: '●', color: 'var(--signal)' };
		if (tier === 'possible') return { glyph: '◐', color: 'var(--probe)' };
		return { glyph: '○', color: 'var(--faint)' };
	}
</script>

<svelte:head>
	<title>kraken — github email intelligence</title>
	<meta name="description" content="Surface and rank public email addresses from GitHub commit history." />
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
					github email intelligence
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
						style="background: {loading ? 'var(--probe)' : error ? 'var(--danger)' : 'var(--signal)'}"
					></span>
				</span>
				<span class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--muted)">
					{loading ? 'scanning' : error ? 'error' : 'ready'}
				</span>
			</div>
		</header>

		<!-- Command line -->
		<section class="anim-rise mt-9" style="animation-delay: 60ms">
			<div class="flex gap-2.5">
				<label class="field flex-1 flex items-center rounded-lg px-3.5">
					<span class="select-none text-sm pr-2" style="color: var(--signal)">&gt;</span>
					<input
						type="text"
						bind:value={query}
						onkeydown={handleKeydown}
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
					disabled={!canRun}
					class="btn-run rounded-lg px-5 text-sm font-bold tracking-wide"
					style="font-family: var(--font-display)"
				>
					{loading ? '···' : 'extract'}
				</button>
			</div>

			<!-- Scan mode presets -->
			<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
				<span class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--faint)">mode</span>
				<div class="segmented" style="--idx: {modeIndex}" role="group" aria-label="scan mode">
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

		<!-- Live probe readout -->
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

		<!-- Error -->
		{#if error}
			<section
				class="anim-rise-sm mt-7 panel rounded-xl p-5"
				style="border-color: rgba(240,99,99,0.3)"
			>
				<p class="text-[11px] uppercase tracking-[0.2em] mb-1.5" style="color: var(--danger)">
					extraction halted
				</p>
				<p class="text-sm" style="color: var(--text)">{error}</p>
				<p class="text-xs mt-2" style="color: var(--muted)">
					check the username and try again — only public profiles can be scanned.
				</p>
			</section>
		{/if}

		<!-- Results -->
		{#if result}
			<section class="anim-rise-sm mt-7 panel rounded-xl overflow-hidden">
				<!-- summary strip -->
				<div class="grid grid-cols-3">
					<div class="p-4">
						<p class="text-[10px] uppercase tracking-[0.2em] mb-1.5" style="color: var(--muted)">
							target
						</p>
						<p class="text-sm truncate" style="color: var(--text)">{result.username}</p>
					</div>
					<div class="p-4 border-l" style="border-color: var(--line-soft)">
						<p class="text-[10px] uppercase tracking-[0.2em] mb-1.5" style="color: var(--muted)">
							scanned
						</p>
						<p class="text-sm" style="color: var(--text)">
							{result.repos_scanned}r · {result.max_commits}c
						</p>
					</div>
					<div class="p-4 border-l" style="border-color: var(--line-soft)">
						<p class="text-[10px] uppercase tracking-[0.2em] mb-1.5" style="color: var(--muted)">
							found
						</p>
						<p class="text-sm font-bold tabular-nums" style="color: var(--signal)">{displayFound}</p>
					</div>
				</div>

				{#if result.emails.length > 0}
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
							{#each result.emails as m, i (m.address)}
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

		<!-- Footer -->
		<footer
			class="anim-rise mt-14 pt-6 border-t"
			style="border-color: var(--line-soft); animation-delay: 120ms"
		>
			<p class="text-[11px] leading-relaxed" style="color: var(--faint)">
				Reads public git patch metadata from GitHub commit history and ranks each address by how
				closely it matches the target handle. No authentication, public repositories only. Ranking
				reflects handle/email similarity, not confirmed ownership — surfaced addresses may belong to
				co-authors or committers other than the target.
			</p>
			<p class="text-[10px] uppercase tracking-[0.2em] mt-4" style="color: var(--faint)">
				part of project eyrie
			</p>
		</footer>
	</div>
</main>
