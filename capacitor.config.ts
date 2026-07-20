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
	},
	plugins: {
		SplashScreen: {
			// The app hides the splash itself once mounted (see native.ts) so there
			// is no white flash between the splash and the first render.
			launchAutoHide: false,
			backgroundColor: '#ffffff',
			showSpinner: false
		},
		// Let @capacitor-community/safe-area own the edge-to-edge insets (it fixes
		// env(safe-area-inset-*) on Android); disable Capacitor's built-in handling
		// so the two do not fight.
		SystemBars: {
			insetsHandling: 'disable'
		},
		// On-device SQLite (P1 persistence). No encryption: the data is a local
		// cache of public tab metadata, so a passphrase would only add friction.
		CapacitorSQLite: {
			androidIsEncryption: false
		}
	}
	// The search API is optional (the app works offline without it). If the real
	// API blocks the https://localhost WebView origin via CORS, either allow that
	// origin on the API or enable CapacitorHttp here to route fetch through native:
	//   plugins: { ..., CapacitorHttp: { enabled: true } }
	// Leave it off by default so soundfont range requests are not intercepted.
};

export default config;
