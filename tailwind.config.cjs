const config = {
  content: ["./src/**/*.{html,js,svelte,ts}"],
	darkMode: 'class',
	theme: {
		extend: {
			fontFamily: {
				sans: ['"Open Sans"', 'sans-serif'],
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
        // TODO
      }
    }
  },
  plugins: []
};

module.exports = config;