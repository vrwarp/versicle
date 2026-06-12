/**
 * SectionQueueBuilder — the PURE queue-building half of the strangled
 * AudioContentPipeline (Phase 5c; phase5-tts-strangler.md §5c.2):
 * `(sentences, settings, options) → {queue, title}`. No ports, no side
 * effects — the HOST (PlaybackController) fetches content, resolves the
 * title, and writes the reader UI; this module only transforms.
 *
 * The empty-section filler is deterministic and keyed by book language
 * (./emptySectionMessages — the randomized English NO_TEXT_MESSAGES died).
 */
import { TextSegmenter } from './TextSegmenter';
import type { SentenceNode } from './sentence-extraction';
import type { TTSQueueItem } from '~types/tts';
import { emptySectionMessage } from './emptySectionMessages';

export interface QueueBuildSettings {
    /** Merged custom + (when enabled) Bible abbreviations — see AbbreviationMerger. */
    abbreviations: string[];
    alwaysMerge: string[];
    sentenceStarters: string[];
    minSentenceLength: number;
    /** Book language (BCP-47 or bare code) — drives segmentation + filler locale. */
    language: string;
}

export interface QueueBuildOptions {
    /** Resolved section title (resolveSectionTitle); undefined → `Section N` fallback. */
    sectionTitle?: string;
    /** Zero-based section index (drives the `Section N` fallback). */
    sectionIndex: number;
    prerollEnabled: boolean;
    /** Current playback speed — used for the preroll's reading-time estimate. */
    speed: number;
    /** The section's character count — used for the preroll's word-count estimate. */
    characterCount: number;
}

export interface SectionQueue {
    queue: TTSQueueItem[];
    /** The final display title (input title or the generic fallback). */
    title: string;
}

/**
 * Builds the playable queue for one section from its prepared sentences.
 * Pure: same inputs → same queue.
 */
export function buildSectionQueue(
    sentences: ReadonlyArray<SentenceNode>,
    settings: QueueBuildSettings,
    options: QueueBuildOptions,
): SectionQueue {
    const title = options.sectionTitle || `Section ${options.sectionIndex + 1}`;
    const queue: TTSQueueItem[] = [];

    if (sentences.length > 0) {
        // Dynamic Refinement: merge segments based on current settings.
        const finalSentences = TextSegmenter.refineSegments(
            sentences as SentenceNode[],
            settings.abbreviations,
            settings.alwaysMerge,
            settings.sentenceStarters,
            settings.minSentenceLength,
            settings.language,
        );

        if (options.prerollEnabled) {
            const prerollText = generatePreroll(title, Math.round(options.characterCount / 5), options.speed);
            queue.push({
                text: prerollText,
                cfi: null,
                isPreroll: true,
                title,
            });
        }

        finalSentences.forEach((s) => {
            if (s.cfi) {
                queue.push({
                    text: s.text,
                    cfi: s.cfi,
                    sourceIndices: s.sourceIndices,
                    isSkipped: false,
                    title,
                });
            }
        });
    } else {
        // Empty chapter: one deterministic, language-keyed informational item.
        queue.push({
            text: emptySectionMessage(settings.language),
            cfi: null,
            isPreroll: true,
            title,
        });
    }

    return { queue, title };
}

/**
 * Generates a spoken preroll message estimating the reading time.
 *
 * @param chapterTitle The title of the chapter.
 * @param wordCount The word count of the chapter.
 * @param speed The playback speed.
 * @returns The formatted string.
 */
export function generatePreroll(chapterTitle: string, wordCount: number, speed: number = 1.0): string {
    const WORDS_PER_MINUTE = 180;
    const adjustedWpm = WORDS_PER_MINUTE * speed;
    const minutes = Math.max(1, Math.round(wordCount / adjustedWpm));
    return `${chapterTitle}. Estimated reading time: ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}
