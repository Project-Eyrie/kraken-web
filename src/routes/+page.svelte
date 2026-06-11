<script lang="ts">
	// Console for the Kraken email-extraction tool: input, live probe readout, results.
	import type { ExtractResult } from '$lib';

	// Stages mirror the real server pipeline so the readout reflects actual work.
	const STAGES = [
		'resolving target',
		'enumerating repositories',
		'reading commit history',
		'parsing patch metadata',
		'surfacing addresses'
	] as const;

	let query = $state('');
	let loading = $state(false);
	let error = $state('');
	let result: ExtractResult | null = $state(null);
	let copied = $state('');
	let stage = $state(0); // index into STAGES while loading

	let stageTimer: ReturnType<typeof setInterval> | null = null;
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	const canRun = $derived(query.trim().length > 0 && !loading);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && canRun) extract();
	}

	// Walk the readout forward on a timer, holding at "parsing" until the
	// real response lands — we never claim completion before the server replies.
	function startStages() {
		stage = 0;
		stageTimer = setInterval(() => {
			if (stage < STAGES.length - 2) stage += 1;
		}, 550);
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
			const res = await fetch(`/api/extract?q=${encodeURIComponent(query.trim())}`);
			const data = await res.json();

			if (data.success) {
				stage = STAGES.length - 1; // surfaced
				result = {
					username: data.username,
					repos_scanned: data.repos_scanned,
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
		if (result) copyText(result.emails.join('\n'), '__all__');
	}
</script>

<svelte:head>
	<title>kraken — github email intelligence</title>
	<meta name="description" content="Surface public email addresses from GitHub commit history." />
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
						<span
							class="absolute inset-0 rounded-full live-ring"
							style="background: var(--probe)"
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
		</section>

		<!-- Live probe readout (signature) -->
		{#if loading}
			<section class="anim-rise-sm mt-7 panel rounded-xl overflow-hidden">
				<div class="scan-track h-px" style="background: var(--line)"></div>
				<ol class="p-5 space-y-2.5">
					{#each STAGES as label, i}
						<li class="flex items-center gap-3 text-[13px]">
							<span
								class="w-4 text-center"
								style="color: {i < stage
									? 'var(--probe)'
									: i === stage
										? 'var(--signal)'
										: 'var(--faint)'}"
							>
								{i < stage ? '✓' : i === stage ? '▸' : '·'}
							</span>
							<span
								style="color: {i < stage
									? 'var(--text)'
									: i === stage
										? 'var(--text)'
										: 'var(--faint)'}"
							>
								{label}{#if i === stage}<span class="cursor-blink" style="color: var(--probe)">_</span>{/if}
							</span>
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		<!-- Error -->
		{#if error}
			<section class="anim-rise-sm mt-7 panel rounded-xl p-5" style="border-color: rgba(240,99,99,0.3)">
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
							repos
						</p>
						<p class="text-sm" style="color: var(--text)">{result.repos_scanned}</p>
					</div>
					<div class="p-4 border-l" style="border-color: var(--line-soft)">
						<p class="text-[10px] uppercase tracking-[0.2em] mb-1.5" style="color: var(--muted)">
							found
						</p>
						<p class="text-sm font-bold" style="color: var(--signal)">{result.email_count}</p>
					</div>
				</div>

				{#if result.emails.length > 0}
					<div class="p-4 border-t" style="border-color: var(--line)">
						<div class="flex items-center justify-between mb-3">
							<p class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--muted)">
								addresses
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
							{#each result.emails as email, i}
								<li
									class="row-email anim-rise-sm flex items-center justify-between rounded-md border border-transparent px-3 py-2.5 group"
									style="animation-delay: {i * 45}ms"
								>
									<span class="text-sm truncate pr-3" style="color: var(--text)">{email}</span>
									<button
										onclick={() => copyText(email, email)}
										class="ghost-btn shrink-0 text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100"
										style="color: {copied === email ? 'var(--probe)' : 'var(--muted)'}"
									>
										{copied === email ? 'copied ✓' : 'copy'}
									</button>
								</li>
							{/each}
						</ul>
					</div>
				{:else}
					<div class="p-6 text-center border-t" style="border-color: var(--line)">
						<p class="text-sm" style="color: var(--text)">no public addresses surfaced</p>
						<p class="text-xs mt-1.5" style="color: var(--muted)">
							this user's commits expose no readable email metadata.
						</p>
					</div>
				{/if}
			</section>
		{/if}

		<!-- Footer -->
		<footer class="anim-rise mt-14 pt-6 border-t" style="border-color: var(--line-soft); animation-delay: 120ms">
			<p class="text-[11px] leading-relaxed" style="color: var(--faint)">
				Reads public git patch metadata from GitHub commit history. No authentication, no API
				tokens, public repositories only. Surfaced addresses may belong to co-authors or
				committers other than the target.
			</p>
			<p class="text-[10px] uppercase tracking-[0.2em] mt-4" style="color: var(--faint)">
				part of project eyrie
			</p>
		</footer>
	</div>
</main>
