import { useEffect, useRef, useState, useCallback } from 'react';
import { useTTSStore } from '../store/useTTSStore';
import { extractSentences, type SentenceNode } from '../lib/tts';
import { Rendition } from 'epubjs';

/**
 * Custom hook to manage Text-to-Speech (TTS) functionality.
 * Handles extracting sentences from the current rendition, managing the SpeechSynthesis API,
 * and synchronizing playback state with the TTS store.
 *
 * @param rendition - The current epubjs Rendition object, used to extract text content.
 * @returns An object containing the extracted sentences for the current view.
 */
export const useTTS = (rendition: Rendition | null) => {
  const {
    isPlaying,
    rate,
    voice,
    activeCfi,
    setPlaying,
    setActiveCfi,
    stop
  } = useTTSStore();

  const [sentences, setSentences] = useState<SentenceNode[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const synth = window.speechSynthesis;
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);

  // Load sentences when chapter changes
  useEffect(() => {
    if (!rendition) return;

    const loadSentences = () => {
       try {
           const extracted = extractSentences(rendition);
           setSentences(extracted);
           setCurrentIndex(0);
       } catch (e) {
           console.error("Failed to extract sentences", e);
           setSentences([]);
       }
    };

    rendition.on('rendered', loadSentences);
    // Also try immediately if already rendered
    if (rendition.getContents().length > 0) {
        loadSentences();
    }

    return () => {
        rendition.off('rendered', loadSentences);
    };
  }, [rendition]);

  // Handle Playback Loop
  const speakSentence = useCallback((index: number) => {
      if (!synth) return;
      if (index >= sentences.length) {
          // Try to go to next chapter?
          // For now, just stop.
          setPlaying(false);
          setActiveCfi(null);
          return;
      }

      const sentence = sentences[index];

      // Cancel any current speech
      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(sentence.text);
      if (voice) utterance.voice = voice;
      utterance.rate = rate;

      utterance.onstart = () => {
          setActiveCfi(sentence.cfi);
          setCurrentIndex(index);
      };

      utterance.onend = () => {
          if (useTTSStore.getState().isPlaying) {
              speakSentence(index + 1);
          }
      };

      utterance.onerror = (e) => {
          console.error("TTS Error", e);
          setPlaying(false);
      };

      currentUtterance.current = utterance;
      synth.speak(utterance);

  }, [sentences, rate, voice, setPlaying, setActiveCfi, synth]);

  // Effect to trigger playback or pause
  useEffect(() => {
      if (!synth) return;

      if (isPlaying && sentences.length > 0) {
          // If just starting or resumed
          if (!synth.speaking) {
             speakSentence(currentIndex);
          } else {
             if (synth.paused) {
                 synth.resume();
             }
          }
      } else if (!isPlaying) {
          if (synth.speaking) {
              synth.pause();
          }
      }

      return () => {
          // Cleanup handled in unmount effect
      };
  }, [isPlaying, sentences, currentIndex, speakSentence, synth]);

  // Cleanup on unmount
  useEffect(() => {
      return () => {
          if (synth) synth.cancel();
          stop();
      };
  }, [stop, synth]);

  return {
     sentences
  };
};
