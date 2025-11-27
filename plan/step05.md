# **Step 5: Polish (Annotations, Themes, PWA)**

## **5.1 Overview**
The final phase adds the "user layer": custom annotations (notes/highlights), persistent theming, and PWA capabilities for "native-like" installability.

## **5.2 Annotations System**

### **Data Structure**
Stored in `annotations` object store in IndexedDB.
```typescript
{
  id: "uuid",
  bookId: "uuid",
  cfiRange: "epubcfi(...)",
  color: "yellow", // or class name
  note: "This is a great quote!",
  created: 123456789
}
```

### **Interaction**
1.  **Selection Event:**
    *   `rendition.on('selected', (cfiRange, contents) => { ... })`
    *   Show a popover menu (Highlight | Note | Copy).
2.  **Creating Annotation:**
    *   User clicks "Highlight".
    *   Save to DB.
    *   Call `rendition.annotations.add('highlight', cfiRange)`.
    *   *Clear selection:* `window.getSelection().removeAllRanges()`.
3.  **Loading:**
    *   On book load, fetch annotations for `bookId` from DB.
    *   Batch add to rendition.

## **5.3 Advanced Theming**

### **Custom Themes**
Allow users to define custom colors (bg/fg).
*   `rendition.themes.register('custom', { body: { color: userColor, background: userBg } })`
*   Persist user preferences in `localStorage` or `useReaderStore` (persisted via `persist` middleware).

### **Font Selection**
*   Inject generic font families (`serif`, `sans-serif`) or embed Google Fonts via `rendition.themes.default({ '@font-face': ... })` (complex due to CORS/CSP).
*   *Simpler:* Allow selection of system fonts.

## **5.4 Progressive Web App (PWA)**

### **Manifest (`public/manifest.json`)**
```json
{
  "name": "Versicle Reader",
  "short_name": "Versicle",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#333333",
  "icons": [ ... ]
}
```

### **Service Worker**
*   Use `vite-plugin-pwa`.
*   **Strategy:** `CacheFirst` for assets.
*   **Offline Mode:**
    *   The app shell is cached.
    *   `epub.js` core is cached.
    *   Book data is in IndexedDB (offline ready by default).
    *   *Result:* Fully offline capable reading.

## **5.5 Final Polish**
*   **Empty States:** "No books found. Import one!"
*   **Loading Spinners:** Better UI feedback during ingestion/indexing.
*   **Error Toasts:** "Failed to parse EPUB".

## **5.6 Verification**
*   **Annotations:** Highlight text. Refresh. Highlight persists. Add note.
*   **PWA:** Lighthouse audit (aim for 90+ PWA score). "Install" icon appears in browser.
*   **Offline:** Turn off network. Reload. App loads and opens book.
