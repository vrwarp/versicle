import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

import { SocialLogin } from '@capgo/capacitor-social-login';

import { useGoogleServicesStore } from './store/useGoogleServicesStore';
import { useTTSStore } from './store/useTTSStore';
import { useAnnotationStore } from './store/useAnnotationStore';
import { useReaderUIStore } from './store/useReaderUIStore';

// Expose stores to window for verification tests
if (typeof window !== 'undefined') {
  (window as any).useTTSStore = useTTSStore;
  (window as any).useAnnotationStore = useAnnotationStore;
  (window as any).useGoogleServicesStore = useGoogleServicesStore;
  (window as any).useReaderUIStore = useReaderUIStore;
}

const initializeSocialLogin = async () => {
  const { googleClientId, googleIosClientId } = useGoogleServicesStore.getState();

  await SocialLogin.initialize({
    google: {
      webClientId: googleClientId || import.meta.env.VITE_GOOGLE_CLIENT_ID,
      iOSClientId: googleIosClientId || import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID,
      mode: 'online',
    },
  });
};

initializeSocialLogin().catch(console.error);

useGoogleServicesStore.subscribe((state, prevState) => {
  if (state.googleClientId !== prevState.googleClientId || state.googleIosClientId !== prevState.googleIosClientId) {
    initializeSocialLogin().catch(console.error);
  }
});

/**
 * Application entry point.
 * Mounts the React app to the DOM.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
