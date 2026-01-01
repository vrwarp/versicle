import { dbService } from '../../db/DBService';
import { TextSegmenter } from './TextSegmenter';
import { useTTSStore } from '../../store/useTTSStore';
import { useGenAIStore } from '../../store/useGenAIStore';
import { genAIService } from '../genai/GenAIService';
import { getParentCfi } from '../cfi-utils';
import type { TTSQueueItem } from './AudioPlayerService';
import type { ContentType } from '../../types/content-analysis';
import type { SectionMetadata } from '../../types/db';

const NO_TEXT_MESSAGES = [
    "This chapter appears to be empty.",
    "There is no text to read here.",
    "This page contains only images or formatting.",
    "Silence fills this chapter.",
    "Moving on, as this section has no content.",
    "No words found on this page.",
    "This section is blank.",
    "Skipping this empty section.",
    "Nothing to read here.",
    "This part of the book is silent."
];

export class AudioContentPipeline {
    private analysisPromises = new Map<string, Promise<any>>();

    async loadSection(
        bookId: string,
        section: SectionMetadata,
        sectionTitle?: string,
        prerollEnabled: boolean = false,
        speed: number = 1.0
    ): Promise<TTSQueueItem[]> {

        const ttsContent = await dbService.getTTSContent(bookId, section.sectionId);
        const bookMetadata = await dbService.getBookMetadata(bookId);

        // Determine Title
        let title = sectionTitle || `Section`; // Fallback, though AudioPlayerService usually passes index-based title
        if (!sectionTitle) {
            const analysis = await dbService.getContentAnalysis(bookId, section.sectionId);
            if (analysis && analysis.structure.title) {
                title = analysis.structure.title;
            }
        }

        // Note: Blob-based cover URL generation is handled by AudioPlayerService to manage lifecycle.

        const newQueue: TTSQueueItem[] = [];

        if (ttsContent && ttsContent.sentences.length > 0) {
            const settings = useTTSStore.getState();
            const refinedSentences = TextSegmenter.refineSegments(
                ttsContent.sentences,
                settings.customAbbreviations,
                settings.alwaysMerge,
                settings.sentenceStarters,
                settings.minSentenceLength
            );

            const genAISettings = useGenAIStore.getState();
            const skipTypes = genAISettings.contentFilterSkipTypes;
            const isContentAnalysisEnabled = genAISettings.isContentAnalysisEnabled;

            let finalSentences: { text: string; cfi: string | null }[] = refinedSentences;

            if (skipTypes.length > 0 && isContentAnalysisEnabled) {
                finalSentences = await this.detectAndFilterContent(bookId, section.sectionId, refinedSentences, skipTypes);
            }

            if (prerollEnabled) {
                const prerollText = this.generatePreroll(title, Math.round(section.characterCount / 5), speed);
                newQueue.push({
                    text: prerollText,
                    cfi: null,
                    isPreroll: true,
                    title: title,
                    bookTitle: bookMetadata?.title,
                    author: bookMetadata?.author,
                    // coverUrl will be injected by the service if needed
                });
            }

            finalSentences.forEach((s) => {
                if (s.cfi) {
                    newQueue.push({
                        text: s.text,
                        cfi: s.cfi,
                        title: title,
                        bookTitle: bookMetadata?.title,
                        author: bookMetadata?.author,
                    });
                }
            });
        } else {
            const randomMessage = NO_TEXT_MESSAGES[Math.floor(Math.random() * NO_TEXT_MESSAGES.length)];
            newQueue.push({
                text: randomMessage,
                cfi: null,
                isPreroll: true,
                title: title,
                bookTitle: bookMetadata?.title,
                author: bookMetadata?.author,
            });
        }

        return newQueue;
    }

    private generatePreroll(chapterTitle: string, wordCount: number, speed: number = 1.0): string {
        const WORDS_PER_MINUTE = 180;
        const adjustedWpm = WORDS_PER_MINUTE * speed;
        const minutes = Math.max(1, Math.round(wordCount / adjustedWpm));
        return `${chapterTitle}. Estimated reading time: ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }

    private async detectAndFilterContent(
        bookId: string,
        sectionId: string,
        sentences: { text: string; cfi: string | null }[],
        skipTypes: ContentType[]
    ): Promise<{ text: string; cfi: string | null }[]> {
        const groups = this.groupSentencesByRoot(sentences);
        const detectedTypes = await this.getOrDetectContentTypes(bookId, sectionId, groups);

        if (detectedTypes && detectedTypes.length > 0) {
            const typeMap = new Map<string, ContentType>();
            detectedTypes.forEach((r: { rootCfi: string; type: ContentType }) => typeMap.set(r.rootCfi, r.type));

            const skipRoots = new Set<string>();
            groups.forEach(g => {
                const type = typeMap.get(g.rootCfi);
                if (type && skipTypes.includes(type)) {
                    skipRoots.add(g.rootCfi);
                }
            });

            if (skipRoots.size > 0) {
                const finalSentences: { text: string; cfi: string | null }[] = [];
                for (const g of groups) {
                    if (!skipRoots.has(g.rootCfi)) {
                        finalSentences.push(...g.segments);
                    }
                }
                return finalSentences;
            }
        }

        return sentences;
    }

    private groupSentencesByRoot(sentences: { text: string; cfi: string | null }[]): { rootCfi: string; segments: { text: string; cfi: string | null }[]; fullText: string }[] {
        const groups: { rootCfi: string; segments: { text: string; cfi: string | null }[]; fullText: string }[] = [];
        let currentGroup: { rootCfi: string; segments: { text: string; cfi: string | null }[]; fullText: string } | null = null;

        for (const s of sentences) {
            const rootCfi = getParentCfi(s.cfi || ''); // Handle null cfi

            if (!currentGroup || currentGroup.rootCfi !== rootCfi) {
                if (currentGroup) groups.push(currentGroup);
                currentGroup = { rootCfi, segments: [], fullText: '' };
            }

            currentGroup.segments.push(s);
            currentGroup.fullText += s.text + ' ';
        }
        if (currentGroup) groups.push(currentGroup);
        return groups;
    }

    private async getOrDetectContentTypes(bookId: string, sectionId: string, groups: { rootCfi: string; segments: { text: string; cfi: string | null }[]; fullText: string }[]) {
        const key = `${bookId}:${sectionId}`;
        if (this.analysisPromises.has(key)) {
            return this.analysisPromises.get(key);
        }

        const promise = (async () => {
            const contentAnalysis = await dbService.getContentAnalysis(bookId, sectionId);

            if (contentAnalysis?.contentTypes) {
                return contentAnalysis.contentTypes;
            }

            const aiStore = useGenAIStore.getState();
            const canUseGenAI = genAIService.isConfigured() || !!aiStore.apiKey || (typeof localStorage !== 'undefined' && !!localStorage.getItem('mockGenAIResponse'));

            if (!canUseGenAI) {
                return null;
            }

            try {
                const idToCfiMap = new Map<string, string>();

                const nodesToDetect = groups.map((g, index) => {
                    const id = index.toString();
                    idToCfiMap.set(id, g.rootCfi);
                    return {
                        id,
                        sampleText: g.fullText.substring(0, 500)
                    };
                });

                if (!genAIService.isConfigured() && aiStore.apiKey) {
                      genAIService.configure(aiStore.apiKey, 'gemini-1.5-flash');
                }

                if (genAIService.isConfigured()) {
                    const results = await genAIService.detectContentTypes(nodesToDetect);

                    const finalResults = results.map(res => ({
                        rootCfi: idToCfiMap.get(res.id) || '',
                        type: res.type
                    })).filter(r => r.rootCfi !== '');

                    await dbService.saveContentClassifications(bookId, sectionId, finalResults);
                    return finalResults;
                }
            } catch (e) {
                console.warn("Content detection failed", e);
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

    async triggerNextChapterAnalysis(bookId: string, nextSection: SectionMetadata) {
        const genAISettings = useGenAIStore.getState();
        if (!genAISettings.isContentAnalysisEnabled || genAISettings.contentFilterSkipTypes.length === 0) {
            return;
        }

        // Fire and forget, but catch errors
        try {
           const ttsContent = await dbService.getTTSContent(bookId, nextSection.sectionId);
           if (!ttsContent || ttsContent.sentences.length === 0) return;

            const settings = useTTSStore.getState();
            const refinedSentences = TextSegmenter.refineSegments(
                ttsContent.sentences,
                settings.customAbbreviations,
                settings.alwaysMerge,
                settings.sentenceStarters,
                settings.minSentenceLength
            );

           const groups = this.groupSentencesByRoot(refinedSentences);

           await this.getOrDetectContentTypes(bookId, nextSection.sectionId, groups);

        } catch (e) {
            console.warn('Background analysis failed', e);
        }
    }
}
