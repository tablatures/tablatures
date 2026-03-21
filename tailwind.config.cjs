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
				violet: {
					50: '#f5f0ff',
					100: '#ede5ff',
					200: '#d4bfff',
					300: '#b78aff',
					400: '#a06cff',
					500: '#8C52FF',
					600: '#7b3bff',
					700: '#5E17EB',
					800: '#4a11bf',
					900: '#370d8f',
				},
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
