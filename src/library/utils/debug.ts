/**
 * Transient debug flags, toggled from the Header. Not persisted to
 * localStorage by design — reloading the page clears them so a debug
 * session doesn't leak into normal use.
 */
import { writable } from 'svelte/store';

/** When true, components that read history (e.g. HomeFeed's "Continue" row)
 *  should render as if there is no history yet. Lets us preview the empty
 *  state without clearing real user data. */
export const debugEmptyContinue = writable<boolean>(false);
