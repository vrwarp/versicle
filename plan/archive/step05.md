# **Step 5: Annotations System**

## **5.1 Overview**
Implement a robust system for user annotations, allowing readers to highlight text and attach notes to specific passages within a book. This feature leverages `epub.js`'s native CFI (Canonical Fragment Identifier) system and persists data to IndexedDB.

## **5.2 Data Persistence (IndexedDB)**

### **Schema**
We will utilize the existing `annotations` object store in our `EpubLibraryDB`.
**Store Name:** `annotations`
**Key Path:** `id` (UUID)
**Indexes:** `bookId` (to query all annotations for a specific book)

**Interface:**
```typescript
interface Annotation {
  id: string;          // UUID
  bookId: string;      // Foreign key to book
  cfiRange: string;    // The epubcfi range string
  text: string;        // The selected text content
  type: 'highlight' | 'note';
  color: string;       // e.g., "yellow", "#ff0000", "class-name"
  note?: string;       // Optional user text
  created: number;     // Timestamp
}
```

### **Database Operations**
*   `addAnnotation(annotation: Annotation): Promise<void>`
*   `getAnnotations(bookId: string): Promise<Annotation[]>`
*   `deleteAnnotation(id: string): Promise<void>`

## **5.3 User Interaction Flow**

### **1. Selection & Popover**
*   **Listener:** Attach a listener to the `selected` event on the `rendition` object.
    ```typescript
    rendition.on('selected', (cfiRange: string, contents: any) => {
      // 1. Get screen coordinates of the selection to position the popover
      const range = rendition.getRange(cfiRange);
      const rect = range.getBoundingClientRect();

      // 2. Show Popover Menu (Highlight Colors, Note Icon) at `rect`
      setShowPopover({ x: rect.left, y: rect.top, cfiRange });
    });
    ```
*   **UI:** A floating menu component (using a portal or absolute positioning) that offers color choices (Yellow, Green, Blue, Red) and a "Copy" button.

### **2. Creating a Highlight**
*   **Action:** User clicks a color (e.g., Yellow).
*   **Process:**
    1.  Generate a UUID.
    2.  Save the annotation object to IndexedDB.
    3.  Apply the highlight visually:
        ```typescript
        rendition.annotations.add('highlight', cfiRange, {}, null, `highlight-${color}`);
        ```
    4.  Clear the browser text selection: `window.getSelection()?.removeAllRanges()`.

### **3. Managing Annotations**
*   **Clicking a Highlight:**
    *   Add a listener for clicked annotations.
    *   Show a menu to "Delete" or "Edit Note".
*   **Sidebar View:**
    *   Add an "Annotations" tab to the Sidebar (alongside TOC).
    *   List all annotations for the current book, sorted by CFI (location).
    *   Clicking an item in the list navigates the reader: `rendition.display(cfiRange)`.

## **5.4 Implementation Details**

### **Components**
*   `ReaderView.tsx`: Updates to handle selection events and render the `AnnotationPopover`.
*   `AnnotationPopover.tsx`: New component for the floating menu.
*   `AnnotationList.tsx`: New component for the sidebar tab.

### **Styles**
*   Define CSS classes for highlights (e.g., `.highlight-yellow { fill: yellow; fill-opacity: 0.3; mix-blend-mode: multiply; }`).
*   Inject these styles using `rendition.themes.default(...)`.

## **5.5 Verification**
*   **Select Text:** Verify popover appears at correct coordinates.
*   **Persist:** Highlight text, reload page, verify highlight reappears.
*   **Navigation:** Click annotation in sidebar, verify reader jumps to correct location.
*   **Cleanup:** Delete annotation, verify it disappears from screen and DB.

## **Status**
*   [x] Database schema update
*   [x] Store implementation (`useAnnotationStore`)
*   [x] UI Components (`AnnotationPopover`, `AnnotationList`)
*   [x] Reader Integration
*   [x] Unit Tests
