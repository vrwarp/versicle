import type { SectionMetadata } from '../../types/db';
import { dbService } from '../../db/DBService';
import { TextSegmenter } from './TextSegmenter';
import { useTTSStore } from '../../store/useTTSStore';
import { useGenAIStore } from '../../store/useGenAIStore';
import { genAIService } from '../genai/GenAIService';
import { getParentCfi } from '../cfi-utils';
import type { ContentType } from '../../types/content-analysis';
import type { TTSQueueItem } from './AudioPlayerService';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private analysisPromises = new Map<string, Promise<any>>();

  async processSection(
    bookId: string,
    section: SectionMetadata,
    playlist: SectionMetadata[],
    sectionTitle?: string
  ): Promise<{ queue: TTSQueueItem[]; sectionIndex: number } | null> {
    const sectionIndex = playlist.findIndex(s => s.sectionId === section.sectionId);
    if (sectionIndex === -1) return null;

    try {
      const ttsContent = await dbService.getTTSContent(bookId, section.sectionId);

      // Determine Title
      let title = sectionTitle || `Section ${sectionIndex + 1}`;
      if (!sectionTitle) {
        const analysis = await dbService.getContentAnalysis(bookId, section.sectionId);
        if (analysis && analysis.structure.title) {
          title = analysis.structure.title;
        }
      }

      const bookMetadata = await dbService.getBookMetadata(bookId);

      let coverUrl = bookMetadata?.coverUrl;
      // Note: We are not handling blob URL creation here to keep it pure.
      // The service should inject the resolved URL or handle it.
      // For now, we rely on bookMetadata.coverUrl which might be a blob url if already processed,
      // but in AudioPlayerService it was creating it on the fly.
      // Ideally, AudioPlayerService should pass the currentCoverUrl to this pipeline or handle it before/after.
      // Let's assume AudioPlayerService handles cover URL lifecycle and we just use what's available or leave it undefined to be filled by the service.

      // Actually, looking at the code, AudioPlayerService manages `currentCoverUrl`.
      // We should probably accept `coverUrl` as an argument.

      // Let's modify the signature to accept coverUrl.
      return await this.buildQueue(
          bookId,
          section,
          sectionIndex,
          ttsContent?.sentences || [],
          title,
          bookMetadata?.title,
          bookMetadata?.author,
          coverUrl
      );

    } catch (e) {
      console.error("Failed to load section content", e);
      return null;
    }
  }

  // Overloaded method to fix the coverUrl issue mentioned above
  async processSectionWithCover(
      bookId: string,
      section: SectionMetadata,
      playlist: SectionMetadata[],
      coverUrl: string | undefined,
      sectionTitle?: string
  ): Promise<{ queue: TTSQueueItem[]; sectionIndex: number } | null> {
      const sectionIndex = playlist.findIndex(s => s.sectionId === section.sectionId);
      if (sectionIndex === -1) return null;

      try {
          const ttsContent = await dbService.getTTSContent(bookId, section.sectionId);

           // Determine Title
            let title = sectionTitle || `Section ${sectionIndex + 1}`;
            if (!sectionTitle) {
                const analysis = await dbService.getContentAnalysis(bookId, section.sectionId);
                if (analysis && analysis.structure.title) {
                    title = analysis.structure.title;
                }
            }

            const bookMetadata = await dbService.getBookMetadata(bookId);

            return await this.buildQueue(
                bookId,
                section,
                sectionIndex,
                ttsContent?.sentences || [],
                title,
                bookMetadata?.title,
                bookMetadata?.author,
                coverUrl
            );

      } catch (e) {
          console.error("Failed to load section content", e);
          return null;
      }
  }

  private async buildQueue(
      bookId: string,
      section: SectionMetadata,
      sectionIndex: number,
      sentences: { text: string; cfi: string | null }[],
      title: string,
      bookTitle: string | undefined,
      author: string | undefined,
      coverUrl: string | undefined
  ): Promise<{ queue: TTSQueueItem[]; sectionIndex: number }> {
      const newQueue: TTSQueueItem[] = [];

      if (sentences.length > 0) {
          const settings = useTTSStore.getState();
          // Fix TS2345: Map strict object type to SentenceNode compatible type
          // refineSegments expects SentenceNode[] which has string, but dbService allows string | null.
          const inputSentences = sentences
            .filter(s => s.cfi !== null)
            .map(s => ({ text: s.text, cfi: s.cfi as string }));

          const refinedSentences = TextSegmenter.refineSegments(
              inputSentences,
              settings.customAbbreviations,
              settings.alwaysMerge,
              settings.sentenceStarters,
              settings.minSentenceLength
          );

          const genAISettings = useGenAIStore.getState();
          const skipTypes = genAISettings.contentFilterSkipTypes;
          const isContentAnalysisEnabled = genAISettings.isContentAnalysisEnabled;

          // refinedSentences is SentenceNode[], which has cfi: string
          // finalSentences needs to be { text: string; cfi: string | null }[]
          // Since SentenceNode is compatible with this (string is assignable to string | null), we can cast or map.
          let finalSentences: { text: string; cfi: string | null }[] = refinedSentences;

          if (skipTypes.length > 0 && isContentAnalysisEnabled) {
              finalSentences = await this.detectAndFilterContent(bookId, section.sectionId, refinedSentences, skipTypes);
          }

          // We don't have access to `prerollEnabled` state or `generatePreroll` easily without coupling.
          // The caller should handle preroll insertion or we pass it as config.
          // Let's keep it simple: return the core content. AudioPlayerService can prepend preroll.

          finalSentences.forEach((s) => {
              if (s.cfi) {
                  newQueue.push({
                      text: s.text,
                      cfi: s.cfi,
                      title: title,
                      bookTitle: bookTitle,
                      author: author,
                      coverUrl: coverUrl
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
              bookTitle: bookTitle,
              author: author,
              coverUrl: coverUrl
          });
      }

      return { queue: newQueue, sectionIndex };
  }

  async detectAndFilterContent(
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
                  } else {
                      console.log(`Skipping content block (Cached/Detected)`, g.rootCfi);
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
          const rootCfi = getParentCfi(s.cfi || '');

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
                      sampleText: g.fullText.substring(0, 200)
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

  async triggerNextChapterAnalysis(
    bookId: string,
    currentSectionIndex: number,
    playlist: SectionMetadata[]
  ) {
      const genAISettings = useGenAIStore.getState();
      if (!genAISettings.isContentAnalysisEnabled || genAISettings.contentFilterSkipTypes.length === 0) {
          return;
      }

      if (currentSectionIndex === -1) return;

      const nextIndex = currentSectionIndex + 1;
      if (nextIndex >= playlist.length) return;

      const nextSection = playlist[nextIndex];

      (async () => {
          try {
             const ttsContent = await dbService.getTTSContent(bookId, nextSection.sectionId);
             if (!ttsContent || ttsContent.sentences.length === 0) return;

              const settings = useTTSStore.getState();
              // Fix TS2322: Map strict object type to SentenceNode compatible type
              const inputSentences = ttsContent.sentences
                .filter(s => s.cfi !== null)
                .map(s => ({ text: s.text, cfi: s.cfi as string }));

              const refinedSentences = TextSegmenter.refineSegments(
                  inputSentences,
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
      })();
  }
}
