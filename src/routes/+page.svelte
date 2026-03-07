<script lang="ts">
	// Main page component handling username input, API calls, and result display
	import type { ExtractResult } from '$lib';

	let query = $state('');
	let loading = $state(false);
	let error = $state('');
	let result: ExtractResult | null = $state(null);
	let copied = $state('');

	// Triggers extraction when the Enter key is pressed in the input field
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && query.trim() && !loading) {
			extract();
		}
	}

	// Sends the username to the extract API and updates component state with the response
	async function extract() {
		if (!query.trim() || loading) return;

		loading = true;
		error = '';
		result = null;

		try {
			const res = await fetch(`/api/extract?q=${encodeURIComponent(query.trim())}`);
			const data = await res.json();

			if (data.success) {
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
			error = 'failed to connect to server';
		} finally {
			loading = false;
		}
	}

	// Copies a string to the clipboard and shows a temporary confirmation state
	async function copyToClipboard(text: string) {
		await navigator.clipboard.writeText(text);
		copied = text;
		setTimeout(() => {
			copied = '';
		}, 2000);
	}

	// Copies all extracted email addresses as a newline-separated list
	async function copyAll() {
		if (!result) return;
		await navigator.clipboard.writeText(result.emails.join('\n'));
		copied = '__all__';
		setTimeout(() => {
			copied = '';
		}, 2000);
	}
</script>

<svelte:head>
	<title>kraken</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="min-h-screen bg-black text-white font-mono flex flex-col items-center px-4 py-20">
	<div class="w-full max-w-lg animate-fade-in">
		<div class="mb-10">
			<h1 class="text-3xl font-bold tracking-tighter mb-2">
				kraken<span class="text-zinc-600">_</span>
			</h1>
			<p class="text-zinc-500 text-xs tracking-wide uppercase">github email intelligence</p>
		</div>

		<div class="flex gap-2">
			<div class="relative flex-1">
				<span class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 text-xs select-none"
					>></span
				>
				<input
					type="text"
					bind:value={query}
					onkeydown={handleKeydown}
					placeholder="github username"
					class="w-full bg-black border rounded px-4 py-2.5 pl-7 text-sm text-white placeholder:text-zinc-700 focus:outline-none transition-all duration-300 border-zinc-800 focus:border-zinc-400"
				/>
			</div>
			<button
				onclick={extract}
				disabled={loading || !query.trim()}
				class="border border-zinc-800 rounded px-4 py-2.5 text-sm transition-all duration-300 hover:bg-white hover:text-black hover:border-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white disabled:hover:border-zinc-800"
			>
				{#if loading}
					<span class="flex items-center gap-1">
						<span class="w-1 h-1 bg-white rounded-full animate-pulse"></span>
						<span class="w-1 h-1 bg-white rounded-full animate-pulse [animation-delay:0.2s]"
						></span>
						<span class="w-1 h-1 bg-white rounded-full animate-pulse [animation-delay:0.4s]"
						></span>
					</span>
				{:else}
					extract
				{/if}
			</button>
		</div>

		{#if loading}
			<div class="mt-8 animate-fade-in">
				<div class="border border-zinc-800 rounded p-4 animate-pulse-border">
					<div class="space-y-3">
						<div class="h-3 w-32 rounded animate-shimmer"></div>
						<div class="h-3 w-48 rounded animate-shimmer [animation-delay:0.2s]"></div>
						<div class="h-3 w-full rounded animate-shimmer [animation-delay:0.4s]"></div>
					</div>
				</div>
			</div>
		{/if}

		{#if error}
			<div class="mt-8 border border-red-500/30 rounded p-4 animate-fade-in">
				<p class="text-sm">
					<span class="text-red-500">err:</span>
					<span class="text-red-400 ml-1">{error}</span>
				</p>
			</div>
		{/if}

		{#if result}
			<div class="mt-8 animate-slide-up">
				<div class="border border-zinc-800 rounded divide-y divide-zinc-800">
					<div class="p-4">
						<p class="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">username</p>
						<p class="text-sm">{result.username}</p>
					</div>

					<div class="p-4 grid grid-cols-2 gap-4">
						<div>
							<p class="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
								repos scanned
							</p>
							<p class="text-sm">{result.repos_scanned}</p>
						</div>
						<div>
							<p class="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">emails found</p>
							<p class="text-sm">{result.email_count}</p>
						</div>
					</div>

					{#if result.emails.length > 0}
						<div class="p-4">
							<div class="flex items-center justify-between mb-3">
								<p class="text-[10px] uppercase tracking-widest text-zinc-500">addresses</p>
								<button
									onclick={copyAll}
									class="text-[10px] uppercase tracking-widest text-zinc-600 hover:text-white transition-colors"
								>
									{copied === '__all__' ? 'copied' : 'copy all'}
								</button>
							</div>
							<div class="space-y-2">
								{#each result.emails as email}
									<div class="flex items-center justify-between group">
										<p class="text-sm text-zinc-300">{email}</p>
										<button
											onclick={() => copyToClipboard(email)}
											class="text-[10px] uppercase tracking-widest text-zinc-600 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
										>
											{copied === email ? 'copied' : 'copy'}
										</button>
									</div>
								{/each}
							</div>
						</div>
					{:else}
						<div class="p-4">
							<p class="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">result</p>
							<p class="text-sm text-zinc-400">no public email addresses found</p>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<div class="mt-16 pt-8 border-t border-zinc-900">
			<p class="text-[10px] text-zinc-700 tracking-wide">
				extracts email addresses from github commit history using public patch metadata. no
				authentication required. limited to public repositories.
			</p>
		</div>
	</div>
</div>
