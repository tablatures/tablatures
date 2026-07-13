import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'org.tablatures.app',
	appName: 'Tablatures',
	webDir: 'build',
	server: {
		// https://localhost is a secure context so getUserMedia (the tuner) works.
		// NEVER change the scheme/host after shipping: a new origin wipes the
		// WebView localStorage (documented Capacitor incident).
		androidScheme: 'https'
	}
	// The search API is optional (the app works offline without it). If the real
	// API blocks the https://localhost WebView origin via CORS, either allow that
	// origin on the API or enable CapacitorHttp here to route fetch through native:
	//   plugins: { CapacitorHttp: { enabled: true } }
	// Leave it off by default so soundfont range requests are not intercepted.
};

export default config;
