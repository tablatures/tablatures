const colors = require('tailwindcss/colors');

// Semantic palette tokens (UX Round 5, phase 4c). One accent family per role so
// the whole app reads consistently:
//   primary — deep violet: primary actions, active/selected states.
//   love    — rose: favorites / hearts.
//   danger  — rose: destructive & delete actions (same family as love).
//   tool    — emerald: the practice tools (tuner, metronome) ONLY.
// Neutrals (white/black/grays) stay as-is; pink still owns the loop UI.
const violetScale = {
	50: '#f5f0ff',
	100: '#ede5ff',
	200: '#d4bfff',
	300: '#b78aff',
	400: '#a06cff',
	500: '#8C52FF',
	600: '#7b3bff',
	700: '#5E17EB',
	800: '#4a11bf',
	900: '#370d8f'
};

const config = {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	darkMode: 'class',
	theme: {
		extend: {
			fontFamily: {
				sans: ['IBM Plex Sans', 'sans-serif']
			},
			screens: {
				sm: '480px',
				md: '768px',
				lg: '976px',
				xl: '1440px'
			},
			colors: {
				violet: violetScale,
				// Semantic aliases — see the note above.
				primary: violetScale,
				love: colors.rose,
				danger: colors.rose,
				tool: colors.emerald,
				light: '#fafafa',
				dark: '#404040',
				black: '#171717'
			}
		}
	},
	variants: {
		extend: {
			height: ['fullscreen'],
			overflow: ['fullscreen'],
			fontWeight: ['responsive', 'hover', 'focus'],
			opacity: ['hover'],
			borderColor: ['hover', 'focus'],
			margin: ['first', 'last'],
			backgroundColor: ['odd', 'even'],
			scale: ['hover', 'active', 'group-hover']
		}
	},
	plugins: [
		function ({ addVariant }) {
			addVariant('fullscreen', '&:fullscreen');
			addVariant('webkit-fullscreen', '&:-webkit-full-screen'); // Safari
		}
	]
};

module.exports = config;
