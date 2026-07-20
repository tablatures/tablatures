<script lang="ts">
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import Header from '../../library/components/Header.svelte';
	import { favoritesStore } from '../../library/utils/favorites';
	import { historyStore } from '../../library/utils/history';
	import { tabStore } from '../../library/utils/store';
	import { activeVideoId } from '../../library/utils/playerStore';
	import { toastStore } from '../../library/utils/toast';
	import { preferencesStore, DEFAULT_SOUNDFONT, SOUNDFONT_PRESETS } from '../../library/utils/preferences';
	import { saveFile, isNative } from '../../library/utils/native';
	import { onMount } from 'svelte';
	import { tabsRepo, httpCacheRepo } from '../../library/data/repositories';
	import { usage as blobUsage } from '../../library/data/blobStore';
	import {
		getBlobBudgetBytes,
		setBlobBudgetBytes,
		DEFAULT_BUDGET_BYTES
	} from '../../library/data/storagePrefs';
	import { dataReady } from '../../library/data/init';

	// Flip once the first Android release is published and listed on the stores.
	const APP_RELEASED = false;
	// Hide the "Get the app" section inside the installed app itself.
	const showGetApp = APP_RELEASED && !isNative();

	const APP_LINKS = {
		fdroid: 'https://f-droid.org/packages/org.tablatures.app/',
		apk: 'https://github.com/tablatures/tablatures/releases/latest/download/tablatures.apk',
		obtainium:
			'https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fapp%2F%257B%2522id%2522%253A%2522org.tablatures.app%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fgithub.com%252Ftablatures%252Ftablatures%2522%252C%2522author%2522%253A%2522tablatures%2522%252C%2522name%2522%253A%2522Tablatures%2522%252C%2522additionalSettings%2522%253A%2522%257B%255C%2522apkFilterRegEx%255C%2522%253A%255C%2522tablatures-.*%255C%255C%255C%255C.apk%255C%2522%252C%255C%2522invertAPKFilter%255C%2522%253Afalse%257D%2522%257D'
	};

	let importDataInput: HTMLInputElement;
	let customSfUrl = '';
	let customMode = false;
	let showClearConfirm = false;

	// Preserve tab + video query params (same as other pages)
	$: if (browser) {
		const url = new URL(window.location.href);
		const currentTab = $tabStore;
		if (currentTab?.tabId) url.searchParams.set('tab', currentTab.tabId);
		else url.searchParams.delete('tab');
		if ($activeVideoId) url.searchParams.set('video', $activeVideoId);
		else url.searchParams.delete('video');
		window.history.replaceState({}, '', url.toString());
	}

	$: favorites = $favoritesStore;
	$: historyItems = $historyStore;
	$: prefs = $preferencesStore;
	$: isCustomSf = !SOUNDFONT_PRESETS.some(p => p.url === prefs.soundFontUrl);
	$: activePresetId = SOUNDFONT_PRESETS.find(p => p.url === prefs.soundFontUrl)?.id ?? 'custom';
	$: customActive = customMode || isCustomSf;

	$: if (isCustomSf && prefs.soundFontUrl !== 'custom') {
		customSfUrl = prefs.soundFontUrl;
	}

	function handleSoundFontChange(url: string) {
		preferencesStore.update(p => ({ ...p, soundFontUrl: url }));
	}

	function selectPreset(preset: typeof SOUNDFONT_PRESETS[0]) {
		customMode = false;
		handleSoundFontChange(preset.url);
	}

	function enableCustomMode() {
		customMode = true;
		if (customSfUrl.trim()) {
			preferencesStore.update(p => ({ ...p, soundFontUrl: customSfUrl.trim() }));
		}
	}

	function handleCustomSfUrl() {
		if (customSfUrl.trim()) {
			customMode = true;
			preferencesStore.update(p => ({ ...p, soundFontUrl: customSfUrl.trim() }));
		}
	}

	async function exportData() {
		const data = {
			favorites: favorites,
			history: historyItems,
			preferences: prefs,
			exportedAt: new Date().toISOString()
		};
		const fileName = `tablatures-data-${new Date().toISOString().slice(0, 10)}.json`;
		await saveFile(fileName, JSON.stringify(data, null, 2), 'application/json');
		toastStore.success('Data exported');
	}

	function importData() {
		importDataInput?.click();
	}

	async function handleImportData(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		try {
			const text = await file.text();
			const data = JSON.parse(text);
			if (data.favorites && Array.isArray(data.favorites)) {
				for (const item of data.favorites) {
					if (item.id && item.title) {
						favoritesStore.addFavorite(item);
					}
				}
			}
			if (data.history && Array.isArray(data.history)) {
				for (const item of data.history) {
					if (item.id && item.title) {
						historyStore.addToHistory(item);
					}
				}
			}
			if (data.preferences) {
				preferencesStore.set({ ...prefs, ...data.preferences });
			}
			toastStore.success('Data imported');
		} catch {
			toastStore.error('Invalid data file');
		}
		target.value = '';
	}

	// ===== Storage (on-device tab bytes + response cache) =====
	const MB = 1024 * 1024;
	let storageBytes = 0;
	let storedCount = 0;
	let pinnedCount = 0;
	let budgetMB = Math.round(DEFAULT_BUDGET_BYTES / MB);
	let storageLoading = true;
	let clearingCache = false;
	let showDeleteTabsConfirm = false;

	function fmtBytes(b: number): string {
		if (b <= 0) return '0 MB';
		if (b < MB) return `${(b / 1024).toFixed(0)} KB`;
		if (b < 1024 * MB) return `${(b / MB).toFixed(1)} MB`;
		return `${(b / (1024 * MB)).toFixed(2)} GB`;
	}

	async function refreshStorage() {
		if (!browser) return;
		storageLoading = true;
		try {
			await dataReady;
			const [used, stats, budget] = await Promise.all([
				blobUsage(),
				tabsRepo.storedStats(),
				getBlobBudgetBytes()
			]);
			storageBytes = used;
			storedCount = stats.count;
			pinnedCount = stats.pinned;
			budgetMB = Math.round(budget / MB);
		} catch {
			/* storage unavailable */
		} finally {
			storageLoading = false;
		}
	}

	async function applyBudget() {
		const bytes = Math.max(0, Math.round(budgetMB)) * MB;
		try {
			await setBlobBudgetBytes(bytes);
			await dataReady;
			await tabsRepo.enforceBudget(bytes);
			toastStore.success('Storage budget updated');
		} catch {
			/* ignore */
		}
		await refreshStorage();
	}

	async function clearResponseCache() {
		clearingCache = true;
		try {
			await dataReady;
			await httpCacheRepo.clear();
			toastStore.info('Response cache cleared');
		} catch {
			/* ignore */
		} finally {
			clearingCache = false;
		}
	}

	async function unpinTabs() {
		try {
			await dataReady;
			await tabsRepo.unpinAll();
			toastStore.info('Unpinned all saved tabs');
		} catch {
			/* ignore */
		}
		await refreshStorage();
	}

	async function deleteCachedTabs() {
		try {
			await dataReady;
			await tabsRepo.clearAllBytes();
			toastStore.info('Deleted cached tab files');
		} catch {
			/* ignore */
		}
		showDeleteTabsConfirm = false;
		await refreshStorage();
	}

	onMount(refreshStorage);

	function clearAllData() {
		if (!browser) return;
		historyStore.clearHistory();
		for (const f of [...favorites]) {
			favoritesStore.removeFavorite(f.id);
		}
		preferencesStore.reset();
		localStorage.removeItem('tabviewer-settings');
		showClearConfirm = false;
		toastStore.info('All local data cleared');
	}
</script>

<svelte:head>
	<title>Settings - Tablatures</title>
</svelte:head>

<Header showSearch={true} />

<main
	id="main-content"
	class="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-[calc(1.5rem_+_env(safe-area-inset-bottom))] min-h-[calc(100dvh-3.5rem)]"
>
	<!-- Page title -->
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
			<i class="material-icons-outlined !text-2xl text-violet-500">settings</i>
			Settings
		</h1>
	</div>

	<!-- ===== SUPPORT / FEEDBACK BANNER ===== -->
	<div class="mb-6 p-4 rounded-lg border border-violet-200 dark:border-violet-900/50 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20">
		<div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
			<div class="flex items-start sm:items-center gap-3 flex-1 min-w-0">
				<div class="flex-shrink-0 w-10 h-10 rounded-full bg-violet-500/10 dark:bg-violet-500/20 flex items-center justify-center">
					<i class="material-icons-outlined !text-xl text-violet-500">campaign</i>
				</div>
				<div class="min-w-0">
					<p class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Help improve Tablatures</p>
					<p class="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">Report a bug, request a feature, or suggest a new tab source.</p>
				</div>
			</div>
			<div class="flex flex-col sm:flex-row gap-2 flex-shrink-0">
				<a
					href="https://github.com/tablatures/tablatures/issues/new?labels=bug&template=bug_report.md"
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
				>
					<i class="material-icons-outlined !text-base">bug_report</i>
					Report issue
				</a>
				<a
					href="https://github.com/tablatures/tablatures/issues/new?labels=source&template=source_request.md"
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
				>
					<i class="material-icons-outlined !text-base">library_add</i>
					Suggest source
				</a>
				<a
					href="https://github.com/tablatures/tablatures"
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-colors"
				>
					<i class="material-icons-outlined !text-base">star_outline</i>
					Star on GitHub
				</a>
			</div>
		</div>
	</div>

	<!-- ===== GET THE APP ===== -->
	{#if showGetApp}
		<div
			class="mb-6 p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
		>
			<div class="flex items-center gap-2 mb-1">
				<i class="material-icons-outlined !text-xl text-violet-500">install_mobile</i>
				<h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Get the app</h3>
			</div>
			<p class="text-xs text-neutral-600 dark:text-neutral-400 mb-3">
				Install Tablatures on Android for offline use.<span class="hidden sm:inline">
					&nbsp;Scan a code with your phone, or use the buttons below.</span>
			</p>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
				{#each [{ id: 'fdroid', label: 'F-Droid', note: 'Coming soon', action: 'Open F-Droid', href: APP_LINKS.fdroid }, { id: 'apk', label: 'Direct APK', note: 'Latest release', action: 'Download APK', href: APP_LINKS.apk }, { id: 'obtainium', label: 'Obtainium', note: 'Auto-updates', action: 'Add to Obtainium', href: APP_LINKS.obtainium }] as opt}
					<div
						class="flex flex-col items-center text-center gap-2 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
					>
						<img
							src="{base}/qr/{opt.id}.svg"
							alt="{opt.label} QR code"
							width="120"
							height="120"
							class="hidden sm:block rounded bg-white p-1.5"
						/>
						<span class="text-sm font-medium text-neutral-800 dark:text-neutral-100">{opt.label}</span>
						<span class="text-[11px] text-neutral-500 dark:text-neutral-400">{opt.note}</span>
						<a
							href={opt.href}
							target="_blank"
							rel="noopener noreferrer"
							class="w-full mt-auto px-3 py-2 text-xs font-semibold text-center rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-colors active:scale-[0.98]"
						>
							{opt.action}
						</a>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- ===== AUDIO SECTION ===== -->
	<div class="flex items-center gap-2 mb-3 mt-0">
		<i class="material-icons-outlined text-violet-500 !text-xl">volume_up</i>
		<h3 class="text-base font-semibold text-neutral-800 dark:text-neutral-100">Audio</h3>
	</div>

	<!-- Sound Font - card selector (full width) -->
	<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 mb-3">
		<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Sound Font</label>
		<p class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 mb-2">Choose a sound font for MIDI playback</p>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
			{#each SOUNDFONT_PRESETS as preset}
				<button
					on:click={() => selectPreset(preset)}
					class="text-left p-3 rounded-lg border-2 transition-all
						{activePresetId === preset.id
							? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
							: 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 bg-white dark:bg-neutral-900'}"
				>
					<div class="flex items-center justify-between mb-1">
						<span class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{preset.name}</span>
						<span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full
							{preset.tier === 'light' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
							 preset.tier === 'balanced' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
							 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}"
						>
							{preset.tier}
						</span>
					</div>
					<p class="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">{preset.description}</p>
					<span class="inline-block mt-1.5 text-[10px] font-medium text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">{preset.size}</span>
				</button>
			{/each}

			<!-- Custom URL option — same grid as presets -->
			<button
				on:click={enableCustomMode}
				class="text-left p-3 rounded-lg border-2 transition-all
					{customActive
						? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
						: 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 bg-white dark:bg-neutral-900'}"
			>
				<div class="flex items-center justify-between mb-1">
					<span class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Custom URL</span>
					<span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400">custom</span>
				</div>
				<p class="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">Provide your own .sf2 soundfont URL</p>
				<span class="inline-block mt-1.5 text-[10px] font-medium text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">any</span>
			</button>
		</div>

		{#if customActive}
			<input
				type="url"
				bind:value={customSfUrl}
				on:blur={handleCustomSfUrl}
				on:keydown={(e) => { if (e.key === 'Enter') handleCustomSfUrl(); }}
				placeholder="https://example.com/soundfont.sf2"
				class="w-full mt-3 text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 outline-none focus:border-violet-500 text-neutral-700 dark:text-neutral-300"
			/>
		{/if}
	</div>

	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
		<!-- Default Playback Speed -->
		<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
			<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Default Playback Speed</label>
			<p class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 mb-2">Speed used when opening a new tab</p>
			<div>
				<select
					bind:value={$preferencesStore.defaultSpeed}
					class="w-full text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 outline-none focus:border-violet-500 text-neutral-700 dark:text-neutral-300"
				>
					{#each [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as s}
						<option value={s}>{s}x</option>
					{/each}
				</select>
			</div>
		</div>

		<!-- Default Metronome Volume -->
		<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
			<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Default Metronome Volume</label>
			<p class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 mb-2">Volume: {Math.round(prefs.defaultMetronomeVolume * 100)}%</p>
			<div>
				<input
					type="range" min="0" max="1" step="0.1"
					bind:value={$preferencesStore.defaultMetronomeVolume}
					class="w-full h-2 cursor-pointer appearance-none rounded-full bg-neutral-200 dark:bg-neutral-700
						[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-0
						[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-500 [&::-moz-range-thumb]:border-0"
				/>
			</div>
		</div>

		<!-- Preferred Audio Source -->
		<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
			<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Preferred Audio Source</label>
			<p class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 mb-2">Default audio source when both are available</p>
			<div>
				<select
					bind:value={$preferencesStore.audioSourcePreference}
					class="w-full text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 outline-none focus:border-violet-500 text-neutral-700 dark:text-neutral-300"
				>
					<option value="tab">Tab Sound</option>
					<option value="video">Video Sound</option>
					<option value="both">Both (Tab + Video)</option>
				</select>
			</div>
		</div>

		<!-- Auto-play on Load -->
		<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
			<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Auto-play on Load</label>
			<p class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 mb-2">Automatically start playback when a tab is opened</p>
			<div>
				<button
					class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {$preferencesStore.autoPlayOnLoad ? 'bg-violet-500' : 'bg-neutral-300 dark:bg-neutral-600'}"
					on:click={() => $preferencesStore.autoPlayOnLoad = !$preferencesStore.autoPlayOnLoad}
				>
					<span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {$preferencesStore.autoPlayOnLoad ? 'translate-x-6' : 'translate-x-1'}" />
				</button>
			</div>
		</div>
	</div>

	<!-- ===== DISPLAY SECTION ===== -->
	<div class="flex items-center gap-2 mb-3 mt-6">
		<i class="material-icons-outlined text-violet-500 !text-xl">tune</i>
		<h3 class="text-base font-semibold text-neutral-800 dark:text-neutral-100">Display</h3>
	</div>

	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
		<!-- Tab Scale (Desktop) -->
		<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
			<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Tab Scale (Desktop)</label>
			<p class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 mb-2">Scale: {$preferencesStore.tabScaleDesktop.toFixed(1)}</p>
			<div>
				<input
					type="range" min="0.3" max="1.5" step="0.1"
					bind:value={$preferencesStore.tabScaleDesktop}
					class="w-full h-2 cursor-pointer appearance-none rounded-full bg-neutral-200 dark:bg-neutral-700
						[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-0
						[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-500 [&::-moz-range-thumb]:border-0"
				/>
			</div>
		</div>

		<!-- Tab Scale (Mobile) -->
		<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
			<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Tab Scale (Mobile)</label>
			<p class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 mb-2">Scale: {$preferencesStore.tabScaleMobile.toFixed(1)}</p>
			<div>
				<input
					type="range" min="0.3" max="1.0" step="0.1"
					bind:value={$preferencesStore.tabScaleMobile}
					class="w-full h-2 cursor-pointer appearance-none rounded-full bg-neutral-200 dark:bg-neutral-700
						[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-0
						[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-500 [&::-moz-range-thumb]:border-0"
				/>
			</div>
		</div>

		<!-- Mini Player Preview -->
		<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
			<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Mini Player Preview</label>
			<p class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 mb-2">Show a preview thumbnail in the mini player</p>
			<div>
				<button
					class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {$preferencesStore.showMiniPlayerPreview ? 'bg-violet-500' : 'bg-neutral-300 dark:bg-neutral-600'}"
					on:click={() => $preferencesStore.showMiniPlayerPreview = !$preferencesStore.showMiniPlayerPreview}
				>
					<span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {$preferencesStore.showMiniPlayerPreview ? 'translate-x-6' : 'translate-x-1'}" />
				</button>
			</div>
		</div>
	</div>

	<button
		on:click={() => preferencesStore.reset()}
		class="text-xs text-neutral-400 hover:text-violet-500 transition-colors mb-3"
	>
		Reset all preferences to defaults
	</button>

	<!-- ===== DATA SECTION ===== -->
	<div class="flex items-center gap-2 mb-3 mt-6">
		<i class="material-icons-outlined text-violet-500 !text-xl">storage</i>
		<h3 class="text-base font-semibold text-neutral-800 dark:text-neutral-100">Data</h3>
	</div>

	<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4">
		<div class="flex items-center gap-3">
			<img src="{base}/logos/icon.svg" width="24" height="24" alt="" />
			<p class="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
				All your data (favorites, history, preferences) is stored <strong class="text-neutral-600 dark:text-neutral-300">locally in your browser</strong>. Nothing is sent to any server or database. Clearing your browser cache will erase this data.
			</p>
		</div>

		<div class="flex flex-col sm:flex-row gap-2">
			<!-- Export -->
			<button
				on:click={exportData}
				class="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-300 dark:hover:border-violet-700 transition-colors w-full sm:w-auto"
			>
				<i class="material-icons !text-lg">download</i>
				Export to JSON
			</button>

			<!-- Import -->
			<button
				on:click={importData}
				class="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-300 dark:hover:border-violet-700 transition-colors w-full sm:w-auto"
			>
				<i class="material-icons !text-lg">upload</i>
				Import from JSON
			</button>
			<input
				bind:this={importDataInput}
				on:change={handleImportData}
				type="file"
				accept=".json"
				class="hidden"
			/>

			<!-- Clear -->
			{#if showClearConfirm}
				<div class="flex flex-col sm:flex-row gap-2 items-center">
					<span class="text-sm text-red-500">Are you sure?</span>
					<button
						on:click={clearAllData}
						class="px-4 py-2.5 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors w-full sm:w-auto"
					>
						Yes, clear all
					</button>
					<button
						on:click={() => showClearConfirm = false}
						class="px-4 py-2.5 text-sm font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors w-full sm:w-auto"
					>
						Cancel
					</button>
				</div>
			{:else}
				<button
					on:click={() => showClearConfirm = true}
					class="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-red-200 dark:border-red-900 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors w-full sm:w-auto"
				>
					<i class="material-icons !text-lg">delete_outline</i>
					Clear all data
				</button>
			{/if}
		</div>

		<p class="text-[11px] text-neutral-300 dark:text-neutral-600">
			{favorites.length} favorites &middot; {historyItems.length} history items &middot; {Math.round((JSON.stringify({favorites, history: historyItems, preferences: prefs}).length) / 1024)}KB used
		</p>
	</div>

	<!-- ===== STORAGE SECTION (offline tab cache) ===== -->
	<div class="flex items-center gap-2 mb-3 mt-6">
		<i class="material-icons-outlined text-violet-500 !text-xl">sd_storage</i>
		<h3 class="text-base font-semibold text-neutral-800 dark:text-neutral-100">Storage</h3>
	</div>

	<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4">
		<p class="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
			Tabs you open are cached on this device so they reopen instantly and work
			offline. Favorited and imported tabs are pinned and never evicted; other
			tabs are dropped oldest-first once the budget below is exceeded.
		</p>

		<!-- Usage summary -->
		<div class="grid grid-cols-3 gap-2 text-center">
			<div class="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-2.5">
				<div class="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
					{storageLoading ? '…' : fmtBytes(storageBytes)}
				</div>
				<div class="text-[11px] text-neutral-500 dark:text-neutral-400">On-device usage</div>
			</div>
			<div class="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-2.5">
				<div class="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
					{storageLoading ? '…' : storedCount}
				</div>
				<div class="text-[11px] text-neutral-500 dark:text-neutral-400">Cached tabs</div>
			</div>
			<div class="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-2.5">
				<div class="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
					{storageLoading ? '…' : pinnedCount}
				</div>
				<div class="text-[11px] text-neutral-500 dark:text-neutral-400">Pinned</div>
			</div>
		</div>

		<!-- LRU budget -->
		<div>
			<div class="flex items-center justify-between mb-1">
				<label for="storage-budget" class="text-sm font-medium text-neutral-700 dark:text-neutral-200"
					>Cache budget</label
				>
				<span class="text-xs text-neutral-500 dark:text-neutral-400">{budgetMB} MB</span>
			</div>
			<input
				id="storage-budget"
				type="range"
				min="50"
				max="2000"
				step="50"
				bind:value={budgetMB}
				on:change={applyBudget}
				class="w-full h-2 cursor-pointer appearance-none rounded-full bg-neutral-200 dark:bg-neutral-700
					[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-0
					[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-500 [&::-moz-range-thumb]:border-0"
			/>
			<p class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
				Maximum on-device space for cached tab files. Lowering it evicts the
				oldest unpinned tabs immediately.
			</p>
		</div>

		<!-- Actions -->
		<div class="flex flex-col sm:flex-row gap-2">
			<button
				on:click={clearResponseCache}
				disabled={clearingCache}
				class="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-300 dark:hover:border-violet-700 transition-colors disabled:opacity-50 w-full sm:w-auto"
			>
				<i class="material-icons !text-lg">cached</i>
				Clear response cache
			</button>

			<button
				on:click={unpinTabs}
				class="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-300 dark:hover:border-violet-700 transition-colors w-full sm:w-auto"
			>
				<i class="material-icons !text-lg">push_pin</i>
				Unpin saved tabs
			</button>

			{#if showDeleteTabsConfirm}
				<div class="flex flex-col sm:flex-row gap-2 items-center">
					<span class="text-sm text-red-500">Delete cached tab files?</span>
					<button
						on:click={deleteCachedTabs}
						class="px-4 py-2.5 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors w-full sm:w-auto"
					>
						Yes, delete
					</button>
					<button
						on:click={() => (showDeleteTabsConfirm = false)}
						class="px-4 py-2.5 text-sm font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors w-full sm:w-auto"
					>
						Cancel
					</button>
				</div>
			{:else}
				<button
					on:click={() => (showDeleteTabsConfirm = true)}
					class="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-red-200 dark:border-red-900 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors w-full sm:w-auto"
				>
					<i class="material-icons !text-lg">delete_sweep</i>
					Delete cached tabs
				</button>
			{/if}
		</div>
	</div>
</main>
