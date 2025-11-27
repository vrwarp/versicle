# **Step 7: Progressive Web App (PWA)**

## **7.1 Overview**
Transform Versicle into an installable application that works offline. This involves configuring a Web App Manifest and a Service Worker to cache the application shell and assets.

## **7.2 Web App Manifest**

### **File: `public/manifest.json`**
Define the application identity for the operating system.

```json
{
  "name": "Versicle Reader",
  "short_name": "Versicle",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "description": "Local-first EPUB reader and manager.",
  "icons": [
    {
      "src": "/pwa-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/pwa-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

### **Icons**
*   Generate `pwa-192x192.png` and `pwa-512x512.png`.
*   Place them in `public/`.

## **7.3 Service Worker**

### **Tooling**
We will use `vite-plugin-pwa` for zero-config generation of the service worker.

### **Configuration (`vite.config.ts`)**
*   **Strategy:** `generateSW` (simplest) or `injectManifest` (if custom logic needed). We will start with `generateSW`.
*   **Caching Strategy:**
    *   **StaleWhileRevalidate** for JS/CSS/HTML.
    *   **CacheFirst** for fonts and images.

### **Offline Logic**
*   **App Shell:** The index.html and main JS bundles are cached.
*   **Epub.js:** Bundled with the app, so it is available offline.
*   **Book Content:** Loaded from IndexedDB. This is **already** offline-ready as it doesn't require network requests.
*   **Cover Images:** Blob URLs are generated from IDB data, so they work offline.

## **7.4 Install Experience**

### **Browser Prompt**
*   The browser will automatically prompt to install if criteria are met (Manifest, HTTPS/Localhost, Service Worker).
*   **Optional:** Implement a custom "Install" button in the UI that listens for the `beforeinstallprompt` event.

## **7.5 Verification**
*   **Lighthouse Audit:** Run a PWA audit in Chrome DevTools. Target 100% PWA score.
*   **Offline Test:**
    1.  Load the app.
    2.  Go to Network tab -> "Offline".
    3.  Refresh the page.
    4.  Verify the app loads and books can be opened.
*   **Install:** Verify the app can be installed to the desktop/homescreen and opens in a standalone window.
