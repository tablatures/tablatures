<script lang="ts">
	/** Shared favorite (star) toggle. Encapsulates the favoritesStore
	 *  subscription, toggle + toast, and heart icon so every surface stars a
	 *  tab the same way. `variant` selects the visual shell to match its host. */
	import { favoritesStore } from '../utils/favorites';
	import { toastStore } from '../utils/toast';

	export let id: string = '';
	export let title: string;
	export let artist: string = 'Unknown';
	export let source: string = '';
	export let album: string = '';
	export let type: string = '';
	/** overlay: dark thumbnail overlay (TabCard); pill: neutral pill (ResultCard);
	 *  plain: bare icon button (player); row: square action button (list rows). */
	export let variant: 'overlay' | 'pill' | 'plain' | 'row' = 'pill';
	/** Extra classes appended to the button (e.g. hover-reveal gating). */
	let extraClass = '';
	export { extraClass as class };

	$: isFavorite = id ? $favoritesStore.some((f) => f.id === id) : false;

	const shells = {
		overlay: 'tap-target w-10 h-10 rounded-lg bg-black/70 backdrop-blur-sm transition-colors',
		pill: 'tap-target w-10 h-10 rounded-full transition-transform duration-150 active:scale-90',
		plain: 'tap-target p-1.5 sm:p-2 rounded-full transition-transform duration-150 active:scale-90 hover:bg-neutral-100 dark:hover:bg-neutral-800',
		row: 'tap-target w-9 h-9 rounded-lg transition-colors active:scale-90'
	};

	$: colors = {
		overlay: isFavorite ? 'text-red-400' : 'text-white hover:text-red-400',
		pill: isFavorite
			? 'bg-red-500 text-white hover:bg-red-600'
			: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 hover:bg-red-500 hover:text-white',
		plain: isFavorite ? 'text-red-500' : 'text-neutral-500 dark:text-neutral-400 hover:text-red-400',
		row: isFavorite
			? 'text-red-500 dark:text-red-400'
			: 'text-neutral-400 dark:text-neutral-500 hover:bg-red-500 hover:text-white'
	}[variant];

	$: iconSize = variant === 'plain' ? '!text-lg sm:!text-xl' : variant === 'row' ? '!text-lg' : '!text-xl';

	function toggle(e: Event) {
		e.stopPropagation();
		if (!id) return;
		if (isFavorite) {
			favoritesStore.removeFavorite(id);
			toastStore.info('Removed from favorites');
		} else {
			favoritesStore.addFavorite({ id, title, artist, source, type, album });
			toastStore.success('Added to favorites');
		}
		$favoritesStore = $favoritesStore;
	}
</script>

{#if id}
	<button
		on:click={toggle}
		class="flex items-center justify-center {shells[variant]} {colors} {extraClass}"
		title="{isFavorite ? 'Remove from' : 'Add to'} favorites"
		aria-label="{isFavorite ? 'Remove' : 'Add'} {title} {isFavorite ? 'from' : 'to'} favorites"
	>
		<i class="material-icons {iconSize}">{isFavorite ? 'favorite' : 'favorite_border'}</i>
	</button>
{/if}
