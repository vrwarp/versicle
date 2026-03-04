import re

with open('src/lib/tts/AudioContentPipeline.ts', 'r') as f:
    content = f.read()

# getOrDetectContentTypes was accidentally removed, add it back before groupSentencesByRoot
get_or_detect = """
    /**
     * Retrieves cached content classifications from DB or triggers GenAI detection if missing.
     */
    async getOrDetectContentTypes(bookId: string, sectionId: string, groups: { rootCfi: string; segments: { text: string; cfi: string }[]; fullText: string }[]) {
        // Deduplicate concurrent requests for the same section
        const key = `${bookId}:${sectionId}`;
        if (this.analysisPromises.has(key)) {
            return this.analysisPromises.get(key);
        }

        const promise = (async () => {
            // 1. Check existing classification in DB
            const contentAnalysis = await dbService.getContentAnalysis(bookId, sectionId);

            // If we have stored content types, return them
            if (contentAnalysis?.contentTypes && contentAnalysis.contentTypes.length > 0) {
                return contentAnalysis.contentTypes;
            }

            // RETRY LOGIC: Check status and timestamps
            const RETRY_DELAY = 5 * 60 * 1000; // 5 minutes
            const LOADING_TIMEOUT = 60 * 1000; // 1 minute (in case process died)

            if (contentAnalysis?.status === 'loading') {
                const elapsed = Date.now() - (contentAnalysis.lastAttempt || 0);
                if (elapsed < LOADING_TIMEOUT) {
                    // Still loading, skip
                    return null;
                }
            }

            if (contentAnalysis?.status === 'error') {
                const elapsed = Date.now() - (contentAnalysis.lastAttempt || 0);
                if (elapsed < RETRY_DELAY) {
                    console.warn(`Skipping analysis for ${bookId}/${sectionId}: Recent error (${Math.round(elapsed / 1000)}s ago)`);
                    return null;
                }
            }

            // 2. If not found, detect with GenAI
            const aiStore = useGenAIStore.getState();
            const canUseGenAI = aiStore.isEnabled && (genAIService.isConfigured() || !!aiStore.apiKey || (typeof localStorage !== 'undefined' && !!localStorage.getItem('mockGenAIResponse')));

            if (!canUseGenAI) {
                return null;
            }

            try {
                // Mark as loading to prevent concurrent attempts from other sources
                dbService.markAnalysisLoading(bookId, sectionId);

                const idToCfiMap = new Map<string, string>();

                const nodesToDetect = groups.map((g, index) => {
                    const id = index.toString();
                    idToCfiMap.set(id, g.rootCfi);
                    return {
                        id,
                        sampleText: g.fullText.substring(0, 200)
                    };
                });

                // Ensure service is configured if we have a key
                if (!genAIService.isConfigured() && aiStore.apiKey) {
                    genAIService.configure(aiStore.apiKey, 'gemini-1.5-flash'); // Fallback default
                }

                if (genAIService.isConfigured()) {
                    // Note: Using default model (gemini-1.5-flash) from GenAIService
                    const results = await genAIService.detectContentTypes(nodesToDetect);

                    // Reconstruct the original format for DB persistence
                    const finalResults = results.map(res => ({
                        rootCfi: idToCfiMap.get(res.id) || '',
                        type: res.type
                    })).filter(r => r.rootCfi !== '');

                    // Persist detection results (this sets status to 'success')
                    await dbService.saveContentClassifications(bookId, sectionId, finalResults);
                    return finalResults;
                }
            } catch (e: unknown) {
                console.warn("Content detection failed", e);
                // Mark as error with timestamp
                const message = e instanceof Error ? e.message : String(e);
                dbService.markAnalysisError(bookId, sectionId, message || 'Unknown error');
            }

            return null;
        })();

        this.analysisPromises.set(key, promise);
        try {
            return await promise;
        } finally {
            this.analysisPromises.delete(key);
        }
    }
"""

content = content.replace("    private groupSentencesByRoot(", get_or_detect + "\n    private groupSentencesByRoot(")

with open('src/lib/tts/AudioContentPipeline.ts', 'w') as f:
    f.write(content)
