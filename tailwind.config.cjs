const config = {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	darkMode: 'class',
	theme: {
		extend: {
			fontFamily: {
				sans: ['Roboto', 'sans-serif'],
				serif: ['Vollkorn', 'serif'],
				mono: ['Inconsolata', 'monospace']
			},
			screens: {
				sm: '480px',
				md: '768px',
				lg: '976px',
				xl: '1440px'
			},
			colors: {
				primary: '#673AB7',
				secondary: '#5E17EB',
				light: '#F7F7F7',
				dark: '#404040',
				black: '#1F272D'
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
