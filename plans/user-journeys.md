# User Journeys

This document outlines key user personas and their typical journeys through Versicle, illustrating how the product's features solve real-world problems.

## Persona 1: The Commuter (Seamless Transition)

**Profile**: Sarah, a software engineer who commutes 45 minutes by train. She reads tech books and sci-fi novels. She values continuity and efficiency.

**The Journey**:
1.  **Morning Routine**: At home, Sarah reads *Dune* on her tablet (Android) while having breakfast. She highlights a few passages.
2.  **The Handoff**: She grabs her phone and rushes to the train. Versicle's **Dual Sync** has already pushed her progress and highlights to the cloud (Firestore).
3.  **On the Move**: She opens Versicle on her phone. The **Compass Pill** immediately shows "Resume: Dune" with her exact location from the tablet.
4.  **Eyes-Free**: The train is crowded. She taps the "Play" button on the Compass Pill.
    *   **Smart Handoff**: The audio picks up exactly where she left off.
    *   **Battery Guard**: She locks her phone. The **Background Service** keeps playing efficiently.
    *   **Content Filtering**: As she listens, the **AI Filter** automatically skips a long list of genealogical appendices, keeping the narrative flowing.
5.  **Arrival**: She arrives at work and pauses. The **Session History** logs her reading time.

## Persona 2: The Researcher (Deep Work)

**Profile**: Dr. Aris, a historian analyzing large archives of documents. He deals with heavy PDFs and EPUBs containing complex tables and data. He is privacy-conscious and works offline often.

**The Journey**:
1.  **Ingestion**: Aris drags a folder of 50 heavy EPUBs into Versicle on his laptop.
    *   **Batch Import**: The system processes them rapidly.
    *   **Duplicate Detection**: The **3-Point Fingerprint** alerts him that 5 books are duplicates, skipping them automatically.
2.  **Space Management**: His device storage is limited. He uses **Smart Offloading** to delete the file bodies of the books he's not currently reading, keeping only the metadata and his past notes.
3.  **Complex Content**: He opens a dense economic history book. It has a complex table of GDP data.
    *   **Table Teleprompter**: He activates the Teleprompter. GenAI analyzes the visual table and synthesizes a narrative summary ("The GDP rose steadily from 1950 to 1960..."), which is then read aloud by the TTS engine.
4.  **Ghost Restoration**: Later, he wants to reference an offloaded book. He sees it as a "Ghost Book" in his library. He re-imports the file, and Versicle instantly restores it, relinking it to his existing annotations.

## Persona 3: The Privacy Advocate (Sovereignty)

**Profile**: Elena, a journalist working on sensitive topics. She refuses to use cloud-based reading apps that might track her interests.

**The Journey**:
1.  **Onboarding**: Elena installs Versicle. She skips the "Sign In" step. The app works fully in **Local Mode**.
2.  **Library Management**: She imports her collection. All data stays in IndexedDB.
3.  **Search**: She searches for a specific keyword across her library. The **Worker-based RegExp Search** scans her books entirely in-memory on her device. No search queries are sent to a server.
4.  **Backup**: She buys a new phone.
    *   **Cold Sync**: Instead of syncing to a cloud account, she relies on the **Android Backup Service**. The app's `backup_payload.json` is automatically restored by the OS when she installs Versicle on the new device. Her library appears exactly as she left it, without her ever creating a Versicle account.

## Persona 4: The Accessibility User (Inclusive Reading)

**Profile**: Marcus, a student with low vision who relies on screen readers and high-contrast interfaces.

**The Journey**:
1.  **Visual Setup**: Marcus opens a book. The **Adaptive Contrast** engine extracts the dark blue from the cover and applies a high-contrast dark theme with yellow text, which he finds easiest to read.
2.  **Navigation**: He uses the keyboard to navigate. The app's **Accessibility Layer** ensures focus states are visible and logical.
3.  **Listening**: He gets tired of reading visually. He switches to TTS using the **Piper (WASM)** engine.
    *   **Local Voice**: He selects a high-quality local neural voice that sounds natural but doesn't require an internet connection.
    *   **Lexicon**: He encounters a mispronounced technical term. He adds a **Lexicon Rule** to fix it globally across the app.
