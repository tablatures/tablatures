<script lang="ts">
	import { base } from '$app/paths';
	import { themeStore } from '../utils/theme';

	export let path: string;
	let buttons = [
		{ value: 0, href: '/select/upload', icon: 'download', label: 'Import' },
		{ value: 1, href: '/select/search', icon: 'search', label: 'Search' },
		{ value: 2, href: '/select/about', icon: 'info', label: 'About' }
	];
	$: currentPath = path.replace(base, '') || '/';

	// True for dark, false for light
	let theme: boolean;

	themeStore.subscribe((value) => {
		theme = value;
	});

	function updateTheme() {
		themeStore.set(!theme);
		if (theme) {
			document.documentElement.classList.add('dark');
		} else {
			document.documentElement.classList.remove('dark');
		}
	}
</script>

<nav
	class="flex pt-2 h-[50px] overflow-hidden items-center w-full text-stone-500 dark:text-stone-300"
>
	<div class="pl-[130px] flex w-full justify-center">
		{#each buttons as button}
			<a
				href="{base}{button.href}"
				class="mx-2 {currentPath == button.href ? 'text-secondary' : ''}"
			>
				<i class="material-icons !text-2xl px-2">{button.icon}</i>
				<p class="text-xs mt-[-8px]">{button.label}</p>
			</a>
		{/each}
	</div>
	<div class="flex justify-end">
		<button class="mx-1">
			<i class="!hidden dark:!inline-block material-icons !text-2xl py-1 text-yellow-400">
				nightlight
			</i>
			<i class="dark:!hidden material-icons !text-2xl py-1">light_mode</i>
		</button>

		<label class="relative inline-flex items-center cursor-pointer">
			<input
				id="theme-switcher"
				type="checkbox"
				checked={theme}
				on:change={updateTheme}
				class="sr-only peer"
			/>
			<div
				class="w-[45px] h-6 bg-stone-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[11px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"
			/>
		</label>
		<a href="{base}/" class="rounded border border-stone-500  mx-2">
			<i class="material-icons !text-2xl px-2 py-1">close</i>
		</a>
	</div>
</nav>
