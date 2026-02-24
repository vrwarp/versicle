import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

import { SocialLogin } from '@capgo/capacitor-social-login';

import { useGoogleServicesStore } from './store/useGoogleServicesStore';

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
