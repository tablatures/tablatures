import { browser } from '$app/environment';
import { writable } from 'svelte/store';
// it works with readable stores too!

// create an object w/default values
// true for dark
let theme: boolean = true;

// ensure this only runs in the browser
if (browser) {
	// if the object already exists in localStorage, get it
	// otherwise, use our default values
	theme = localStorage.getItem('theme') == 'true' || false;
}

// export the store for usage elsewhere
export const themeStore = writable<boolean>(theme);
if (browser) {
	// update localStorage values whenever the store values change
	themeStore.subscribe((value) => {
		// localStorage only allows stings
		// IndexedDB does allow for objects though... 🤔
		localStorage.setItem('theme', JSON.stringify(value));
		if (value) {
			document.documentElement.classList.add('dark');
		} else {
			document.documentElement.classList.remove('dark');
		}
	});
}
