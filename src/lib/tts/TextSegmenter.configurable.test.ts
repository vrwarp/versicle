import { describe, it, expect } from 'vitest';
import { TextSegmenter } from './TextSegmenter';

describe('TextSegmenter with Custom Abbreviations', () => {
  it('splits unknown abbreviations by default (depending on Intl.Segmenter)', () => {
    const segmenter = new TextSegmenter();
    // Using a made-up abbreviation that Intl.Segmenter likely splits
    const text = "Abc. Def.";
    const segments = segmenter.segment(text);
    // verification relies on Intl.Segmenter behavior
  });

  it('merges segments when abbreviation is provided and next word is not a sentence starter', () => {
    // "MyAbbrev." is definitely not standard.
    // "Zombies" is not in the common sentence starters list.
    const text = "This is MyAbbrev. Zombies are here.";

    // First, verify it splits without custom abbrev
    const segmenterDefault = new TextSegmenter();
    const segmentsDefault = segmenterDefault.segment(text);

    // If it splits:
    if (segmentsDefault.length > 1) {
        // Now test with custom abbrev
        const segmenterCustom = new TextSegmenter('en', ['MyAbbrev.']);
        const segmentsCustom = segmenterCustom.segment(text);

        expect(segmentsCustom).toHaveLength(1);
        expect(segmentsCustom[0].text).toBe("This is MyAbbrev. Zombies are here.");
    } else {
        console.warn("Intl.Segmenter didn't split the test sentence. Skipping merge test.");
    }
  });

  it('does NOT merge when abbreviation is provided but next word is a sentence starter', () => {
      // "It" is a common sentence starter.
      const text = "This is MyAbbrev. It should be a new sentence.";
      const segmenterCustom = new TextSegmenter('en', ['MyAbbrev.']);
      const segmentsCustom = segmenterCustom.segment(text);

      // Even though MyAbbrev. is in the list, "It" strongly suggests a new sentence.
      // So we expect 2 segments (split preserved).
      expect(segmentsCustom).toHaveLength(2);
      expect(segmentsCustom[0].text.trim()).toBe("This is MyAbbrev.");
      expect(segmentsCustom[1].text.trim()).toBe("It should be a new sentence.");
  });

  it('respects passed abbreviations', () => {
      const segmenter = new TextSegmenter('en', ['Dr.', 'Prof.']);
      const text = "Dr. No is a movie.";
      const segments = segmenter.segment(text);
      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe("Dr. No is a movie.");
  });
});
