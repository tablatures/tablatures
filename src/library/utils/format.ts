/**
 * Format a time value in seconds to MM:SS display.
 */
export function displayTime(time: number): string {
	const minutes = Math.floor(time / 60);
	const seconds = time - minutes * 60;
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
