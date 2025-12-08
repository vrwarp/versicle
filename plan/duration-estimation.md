# **Technical Design: Reading Duration Estimation**

## **1\. Objective**

To provide the user with accurate, context-aware, and real-time estimates for three critical duration metrics:

1. **Chapter Remaining:** The time remaining in the current chapter or listening queue, accounting for the user's current position.  
2. **Book Remaining:** The estimated time required to finish the remainder of the book from the current position.  
3. **Total Book Duration:** The total time required to read the entire book from start to finish at the current reading speed.

These metrics serve to enhance the user experience by setting expectations for reading sessions, allowing users to plan their reading time effectively (e.g., "Do I have time to finish this chapter before my commute ends?"), and providing a sense of progress and accomplishment.

## **2\. Constraints & Assumptions**

The design operates under specific constraints regarding data availability and computational efficiency to ensure a performant user experience, especially on mobile devices.

* **Data Availability & Memory Management:**  
  * **Current Chapter (Precise):** We assume that for the actively playing or reading chapter, the full text content is available in memory. specifically within the useTTSStore.queue. This allows for highly precise character-level calculations.  
  * **Current Chapter (Estimated):** When TTS is not active, we may not have the text immediately loaded in the queue. In this state, we rely on the Section.characterCount stored in the database. This provides a robust fallback without requiring a potentially expensive load operation.  
  * **Future Chapters:** To conserve memory, the full text of future chapters is **NOT** loaded into memory. We strictly rely on the lightweight metadata (specifically Section.characterCount) pre-computed and stored in the database. This "lazy loading" approach is critical for handling large EPUBs without crashing the browser tab.  
* **Pre-computation Strategy:**  
  * Real-time calculation of an entire book's duration would require parsing megabytes of text, which is prohibitive.  
  * Therefore, we adopt a **pre-computation strategy**. We calculate and store character counts for *every* individual chapter (section) during the initial ingestion/import process. These counts are persisted in the sections table of the IndexedDB.  
* **Speed Constants & heuristics:**  
  * **Standard Reading Speed:** We utilize a baseline of **180 Words Per Minute (WPM)**. This is a widely accepted average for silent reading and a comfortable listening pace.  
  * **Average Word Length:** We assume an average word length of **5 characters** (including spaces/punctuation averaged out). This simplifies calculations by allowing us to work directly with character counts (which are unambiguous) rather than word counts (which require complex tokenization).  
  * Formula: The core formula for duration is:  
    Duration (minutes) \= CharacterCount / (180 \* 5 \* PlaybackRate)  
    This formula dynamically adjusts based on the user's variable PlaybackRate, ensuring that a user listening at 2x speed sees the duration estimates halved.

## **3\. Architecture**

### **3.1. Data Model Changes**

To support efficient lookups without re-parsing text, we must augment the database schema. These changes ensure that the necessary "size" metadata is available instantly.

* **Book Interface:**  
  * Add totalChars: number.  
  * This field represents the aggregate sum of all character counts from every section in the book. It allows for O(1) retrieval of the book's total length.  
* **Section (Chapter) Interface:**  
  * Add characterCount: number.  
  * This field stores the precise length of the specific section. Storing this at the section level is crucial for calculating the "Book Remaining" metric, as it allows us to sum only the *remaining* sections relative to the user's current position.

### **3.2. Ingestion Logic (src/lib/ingestion.ts)**

The ingestion process is the heavy lifter in this architecture. By moving the computational cost to the import phase (which happens once), we ensure the reading experience (which happens frequently) remains smooth.

**Process Flow:**

1. **Iterate:** The ingestion engine iterates through the EPUB's spine or Table of Contents (TOC) to identify every unique section.  
2. **Extract:** For each identified section, we perform a text extraction. This is the same process used for search indexing—loading the HTML content and stripping tags to leave only the raw text.  
3. **Compute:** We calculate the length of this raw text string. This is the characterCount.  
4. **Store Section:** We create the Section object, populate it with the characterCount, and prepare it for bulk insertion.  
5. **Accumulate:** We maintain a running total (totalBookChars) by adding each section's count.  
6. **Store Book:** Finally, we create the Book object, populating its totalChars field with the accumulated value.

This ensures that the database is the "source of truth" for duration data immediately after import.

### **3.3. Hook Design (useChapterDuration)**

The hook serves as the bridge between the static database metadata and the dynamic user state. It fuses these two sources to produce live estimates.

**Inputs:**

* **TTS Store:**  
  * queue: The array of text snippets currently queued for playback. This is our source of *high-precision* data for the active chapter.  
  * currentIndex: The pointer to the exact sentence/snippet currently being spoken.  
  * rate: The current playback speed multiplier (e.g., 1.0, 1.5, 2.0).  
* **Reader Store:**  
  * bookId: Identifies the book context.  
  * currentSectionId: Identifies the specific chapter the user is viewing. This is essential for determining *which* sections are "future" sections.  
* **Database (via useLiveQuery):**  
  * We fetch the book object to get totalChars.  
  * We fetch the full list of sections for the book, sorted by playOrder. This sorted list is required to correctly sum the "tail" of the book.

**Logic Breakdown:**

1. **Chapter Remaining Calculation:**  
   * **Scenario A: Active Queue (TTS Playing):** This is the high-precision mode. We slice the queue from the currentIndex to the end. We sum the lengths of these specific text snippets. This accounts for the user being partway through a sentence or paragraph.  
   * **Scenario B: Inactive Queue (Visual Reading):** This is the fallback/low-precision mode. If the queue is empty or unrelated, we look up the characterCount of the currentSectionId from our loaded sections list. *Note: Currently, this treats the user as being at the start of the chapter. Refining this with visual progress percentage is a potential future optimization.*  
2. **Book Total Calculation:**  
   * This is a straightforward arithmetic operation: book.totalChars / (BaseCharsPerMin \* speed).  
   * This value is stable unless the user changes their playback speed.  
3. **Book Remaining Calculation:**  
   * This requires a hybrid approach.  
   * **Step 1:** We identify the index of the currentSectionId within our sorted list of sections.  
   * **Step 2:** We iterate through all sections *after* this index (i.e., index \+ 1 to end). We sum their characterCount properties. This gives us the duration of all *future* chapters.  
   * **Step 3:** We take the result from the "Chapter Remaining" calculation (which handles the *current* chapter's specific remaining time) and add it to the sum from Step 2\.  
   * **Result:** (Remaining in Current Chapter) \+ (Sum of All Future Chapters).

## **4\. Implementation Details**

### **Edge Cases & Defensive Coding**

* **Missing Metadata (Legacy Support):**  
  * Books imported before this feature was implemented will lack totalChars and characterCount.  
  * The system must detect undefined values and return null for the book-wide estimates. This signals the UI to hide the duration display rather than showing "0 mins" or "NaN".  
  * The "Chapter Remaining" might still work if the TTS queue is active, as that relies on live memory, not DB metadata.  
* **Unknown Location:**  
  * If currentSectionId cannot be found in the sections list (e.g., due to a synchronization error or a specialized "front matter" page), the system cannot determine which chapters are "future."  
  * In this case, falling back to Book Total is misleading. Returning null (or just the Total duration as a safe fallback) prevents user confusion.  
* **Playback Speed Safety:**  
  * Users might technically set speed to 0 or near-zero values.  
  * Division by zero would result in Infinity.  
  * We clamp the divisor's rate to a minimum of 0.1 to ensure finite, albeit large, duration numbers.  
* **Queue Validity:**  
  * The useTTSStore might hold a queue from a *previous* book if not cleared properly.  
  * The hook includes a heuristic check: it assumes the queue is relevant only if it has items and the index is valid. Strictly linking the queue's bookId would be even safer (future refactor).
