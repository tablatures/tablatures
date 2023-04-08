<script lang="ts">
	import { base } from '$app/paths';
	import { themeStore } from '../utils/theme';

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

<nav class="flex pt-2 h-[50px] overflow-hidden items-center w-full">
	<img src="{base}/logos/icon.svg" width="48px" height="48px" class="m-1" alt="Tablatures logo" />
	<h1 class="text-2xl dark:text-light">Tablatures</h1>
	<div class="flex w-full justify-end text-stone-500 dark:text-stone-300">
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

		<a href="{base}/select/search" class="rounded border border-stone-500 mx-2">
			<i class="material-icons !text-2xl px-2 py-1">music_note</i>
		</a>
	</div>
</nav>
