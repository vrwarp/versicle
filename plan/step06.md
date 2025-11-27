# **Step 6: Advanced Theming**

## **6.1 Overview**
Enhance the reading experience by providing granular control over typography and color themes. This step moves beyond the basic Light/Dark presets to allow custom user preferences.

## **6.2 Font Selection**

### **Strategy**
Since loading external web fonts (like Google Fonts) inside the iframe can be complex due to CSP and CORS, we will focus on **System Fonts** and **Generic Families** first.

### **Font Options**
*   **Serif:** `Merriweather, Georgia, serif`
*   **Sans-Serif:** `Roboto, Helvetica, Arial, sans-serif`
*   **Monospace:** `Consolas, Monaco, monospace`
*   **Dyslexic Friendly:** `OpenDyslexic` (if bundled) or generic fallbacks.

### **Implementation**
*   **Store:** Add `fontFamily` to `useReaderStore`.
*   **Application:**
    ```typescript
    rendition.themes.font(selectedFontFamily);
    // OR via registration
    rendition.themes.register('custom-font', { body: { 'font-family': selectedFontFamily } });
    ```

## **6.3 Custom Color Themes**

### **User Interface**
*   Add a "Custom" option in the Theme selector.
*   When selected, show color pickers for:
    *   **Background Color**
    *   **Text Color**

### **Implementation**
*   **Store:** Add `customTheme` object `{ bg: string, fg: string }` to `useReaderStore`.
*   **Registration:**
    ```typescript
    rendition.themes.register('custom', {
      body: {
        background: customTheme.bg,
        color: customTheme.fg
      }
    });
    rendition.themes.select('custom');
    ```

## **6.4 Settings UI Overhaul**

### **Modal vs Popover**
*   Expand the current `Settings` popover in `ReaderView` into a more comprehensive menu or a modal.
*   **Tabs/Sections:**
    *   **Display:** Theme (Light/Dark/Sepia/Custom), Brightness (if applicable via overlay).
    *   **Typography:** Font Family, Font Size, Line Height.
    *   **Layout:** Margins (padding), Spacing.

## **6.5 Verification**
*   **Font Change:** Select "Serif", verify text inside iframe changes.
*   **Custom Colors:** Pick Blue background and White text, verify application.
*   **Persistence:** Reload page, verify custom theme and font settings are restored.
