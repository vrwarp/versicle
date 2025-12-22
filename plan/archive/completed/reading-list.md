Reading List & CSV Sync
========================================

1\. Overview
------------

This feature introduces a "Reading List" mechanism that serves as a portable, lightweight record of a user's reading history. Unlike the heavy `books` store which contains binary EPUB data, the Reading List tracks high-level progress (Title, Author, Percentage, Filename, ISBN) and can be imported/exported via CSV.

**Primary Goal:** To enable users to backup their reading progress and easily share or migrate their reading history to external services like Goodreads, StoryGraph, or other book tracking tools.

2\. Requirements
----------------

### Core Features

1.  **Independent Persistent Storage**:

    -   **Architecture**: Reading List data resides in a dedicated IndexedDB object store (`reading_list`), physically decoupled from the `books` store (which holds heavy binary data).

    -   **Data Permanence**: This separation ensures that deleting a book file to free up space does **not** delete the user's reading history or progress record for that book.

    -   **Lightweight Schema**: The store only holds metadata, allowing it to scale to thousands of entries without impacting app performance.

2.  **Interoperable CSV Import/Export**:

    -   **Export**: The generated CSV must be a superset of standard formats. It **must** include standard identifiers (`ISBN`, `Title`, `Author`) for external service compatibility (Goodreads, StoryGraph) and Versicle-specific fields (`Filename`, `Percentage`, `Locations`) for internal state restoration.

    -   **Import**: The parser must be robust against schema variations. It should attempt fuzzy matching on headers to support CSVs hand-edited by users or exported from other tools, falling back to safe defaults if specific columns are missing.

3.  **Decoupled Library Visualization**:

    -   **Overlay Logic**: The Library View must calculate reading progress by querying **both** the active `books` store and the `reading_list` store.

    -   **Visual Indicators**: If a book exists in the file system, its progress bar should reflect the maximum progress recorded in either store. This allows users to see "100% Read" status on a freshly re-imported book file before they even open it.

4.  **Bi-directional Synchronization Strategy**:

    -   **Read -> List (Live Sync)**: Every time the reader saves a location (debounced), the app must upsert the corresponding entry in the `reading_list` store with the new percentage and timestamp.

    -   **List -> Read (Restore Sync)**: Upon importing a CSV or re-adding a book file:

        -   The system scans the `reading_list` for a matching `filename` or `ISBN`.

        -   **Conflict Resolution**: "Highest Progress Wins." If the imported/stored percentage is higher than the current local book state, the local book state is updated to match.

        -   **Location Restoration**: Since CSVs lack precise CFIs, the system must approximate the location using `cfiFromPercentage` if the exact CFI is unavailable.

3\. Data Architecture
---------------------

### 3.1. Schema

We will add a new store `reading_list` to the `versicleDB`. We include `isbn` and `status` to better map to external concepts.

**Interface: `ReadingListEntry`**

```
interface ReadingListEntry {
  filename: string;      // Primary Key (Unique)
  title: string;
  author: string;
  isbn?: string;         // Crucial for Goodreads matching
  percentage: number;    // 0.0 to 1.0
  lastUpdated: number;   // Unix timestamp
  status?: 'read' | 'currently-reading' | 'to-read'; // Derived from percentage
  rating?: number;       // Optional: 1-5, for future proofing
}

```

### 3.2. CSV Format

To ensure compatibility with Goodreads while maintaining Versicle's specific needs, we will use a superset of standard headers.

**Format Specification:**

-   **Standard Headers (Goodreads-friendly):** `Title`, `Author`, `ISBN`, `My Rating`, `Exclusive Shelf`, `Date Read`

-   **Versicle Headers:** `Filename`, `Percentage`

**Example CSV:**

```
Title,Author,ISBN,My Rating,Exclusive Shelf,Percentage,Filename,Date Read
"Ender's Game","Orson Scott Card","9780812550702",5,"read",1.0,"enders_game.epub","2023-01-15"
"Mistborn","Brandon Sanderson","9780765311788",,"currently-reading",0.12,"mistborn.epub",

```

*Note: When exporting, if we don't have an ISBN, we leave it blank. Goodreads can often match on Title+Author, but ISBN is safer.*

4\. Technical Implementation
----------------------------

### 4.1. Storage Layer (`DBService.ts`)

-   **Migration**: Increment DB version. Create `reading_list` object store with `filename` as the key path.

-   **Methods**:

    -   `getReadingList()`: Returns all entries.

    -   `upsertReadingListEntry(entry: ReadingListEntry)`: Updates or adds an entry.

    -   `importReadingList(entries: ReadingListEntry[])`: Bulk upsert logic.

### 4.2. State Management (`useReadingListStore.ts`)

A new Zustand store is likely overkill if the logic is tightly coupled with the Library. However, given the requirement for "complete separation," a dedicated hook/store `useReadingList` that interacts with the DB and exposes the CSV methods is cleaner.

**Responsibilities:**

1.  **Load**: Fetch reading list on mount.

2.  **Export**: Generate CSV blob from DB data.

    -   **Logic**: Map `ReadingListEntry` to the CSV rows.

    -   **Goodreads Compat**: Map `status` to `Exclusive Shelf`. If `percentage` is 1.0, set `Exclusive Shelf` to 'read'.

3.  **Import**: Parse CSV, validate, write to DB, then trigger a "Sync" action.

### 4.3. Synchronization Logic

**Scenario A: User updates progress while reading**

-   **Trigger**: `useReaderStore` updates location/progress.

-   **Action**: Call `DBService.upsertReadingListEntry`.

-   **Logic**:

    -   Map current book metadata to `ReadingListEntry`.

    -   Extract `ISBN` from the book's metadata (OPF) if present.

    -   Calculate `status` based on percentage (>0.98 = 'read', >0 = 'currently-reading').

**Scenario B: CSV Import (or initial sync)**

-   **Trigger**: User uploads CSV.

-   **Action**:

    1.  Parse CSV using a robust parser (handling quotes/commas).

    2.  Map CSV columns to `ReadingListEntry` fields.

        -   **Mapping**: Look for `Title`, `Author`, `ISBN` (standard) AND `Filename`, `Percentage` (custom).

        -   **Fallback**: If `Percentage` is missing but `Exclusive Shelf` is "read", assume 1.0.

    3.  Bulk upsert into `reading_list` store.

    4.  **Reconciliation**: Iterate through all *current* books in the `books` store.

    5.  If `book.filename` matches a `ReadingListEntry`:

        -   If `entry.percentage > book.progress`: Update `book.progress` in `books` store.

        -   *Optional*: We might want a prompt asking if they want to overwrite local progress, but "highest wins" is a safe default for now.

### 4.4. UI Components

1.  **Global Settings Dialog**:

    -   New Tab: "Data & Sync" (or expand existing Data tab).

    -   Section: "Reading List & Backup".

    -   Buttons: "Export to CSV (Goodreads Compatible)", "Import CSV".

    -   Status: "X books in reading list".

2.  **Library View**:

    -   Currently, `BookCard` derives progress from the `Book` object.

    -   **Change**: We need to ensure that when the `ReadingList` is updated, we sync that back to the `Book` object if the file exists.

    -   **Alternative**: The Library View could subscribe to *both* stores and merge them, but that is performance-heavy.

    -   **Decision**: The "Sync" step (Scenario B) is crucial. The `books` store remains the source of truth for the UI. The `reading_list` store acts as a backup/sync service that pushes data *into* the `books` store when changes occur.

5\. Detailed Workflows
----------------------

### 5.1. Export Workflow

1.  User clicks "Export CSV".

2.  Query `DBService.getAll('reading_list')`.

3.  Convert JSON to CSV string:

    -   Ensure header row matches Goodreads expectations where possible (`Title`, `Author`, `ISBN`, `My Rating`, `Exclusive Shelf`, `Date Read`).

    -   Append custom columns `Percentage`, `Filename`.

    -   Quote all string fields to handle commas in titles.

4.  Trigger browser download `versicle_reading_list_[date].csv`.

### 5.2. Import Workflow

1.  User selects file.

2.  FileReader reads text.

3.  Parse CSV lines. Detect headers.

4.  **Header Mapping**: dynamically find which column index corresponds to Title, Author, Percentage, etc.

5.  Validate fields (Percentage must be 0-1 or 0-100, normalize to 0-1).

6.  **Batch Write**: Save to `reading_list` store.

7.  **Sync**:

    -   Fetch all `books`.

    -   For each `book`, check if `reading_list` has a newer/higher progress entry.

    -   If yes, update `book.progress` and `book.locations`.

    -   *Note*: Restoring precise CFI locations from just a percentage is impossible. We might only be able to restore the visual progress bar, unless we simply set `percentage` on the book object. The reader engine needs a CFI to jump to.

    -   **Refinement**: The CSV only stores percentage. If we import a book that is 50% complete according to CSV, but we have no CFI, the app can show "50%" on the card. When the user opens the book, we can calculate a rough CFI based on percentage (epub.js supports `locations.cfiFromPercentage(0.5)`).

6\. Edge Cases
--------------

-   **Filename Mismatch**: If the user renames the file before re-importing, the link is broken. We rely on exact filename matching as requested.

-   **Missing ISBNs**: Older ebooks often lack metadata. Export will leave ISBN blank.

-   **Duplicate Entries in CSV**: Last one wins.

-   **Invalid CSV**: Show error toast.

7\. Implementation Steps
------------------------

1.  **DB Update**: Add `reading_list` store schema to `DBService`.

2.  **Service Methods**: Implement `getReadingList`, `addToReadingList`, `exportReadingList`.

3.  **Hook Integration**: Hook into `useReaderStore` to auto-update the reading list whenever progress saves.

4.  **Settings UI**: Build the Import/Export UI.

5.  **Sync Logic**: Implement the "Apply Reading List to Library" function.
