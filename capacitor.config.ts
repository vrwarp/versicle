import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vrwarp.versicle',
  appName: 'Versicle',
  // Points to the Vite build output directory.
  // Capacitor will copy these files into the Native App bundle.
  webDir: 'dist',
  server: {
    // CRITICAL: Sets the WebView to load from https://localhost instead of http://
    // This is required for:
    // 1. Secure Cookies (if used for auth)
    // 2. Access to Secure Context features (Crypto API, some Audio APIs)
    // 3. CORS compliance when calling external APIs like OpenAI
    androidScheme: 'https',

    // Optional: Set to true only during development to allow live reloading
    // from a local server. Ensure this is false or omitted for production builds.
    cleartext: false,

    // Block all navigation to external URLs from the WebView.
    // This prevents malicious content from redirecting the user to external sites.
    allowNavigation: []
  },
  plugins: {
    // Explicitly enable CapacitorHttp if we plan to proxy requests through the native layer
    // to avoid CORS issues entirely (optional but recommended for robust networking).
    CapacitorHttp: {
      enabled: true,
    },
    MediaSession: {
      foregroundService: "always"
    }
  },
};

export default config;
