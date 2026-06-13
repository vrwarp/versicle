/**
 * Dictionary settings panel (Phase 8 §B): pronunciation lexicon +
 * segmentation/abbreviation rules, formerly inline JSX in the deleted
 * GlobalSettingsDialog.
 */
import React, { useState } from 'react';
import { Button } from '@components/ui/Button';
import { LexiconManager } from '@components/reader/LexiconManager';
import { TTSAbbreviationSettings } from '@components/reader/TTSAbbreviationSettings';

const DictionaryPanel: React.FC = () => {
  const [isLexiconOpen, setIsLexiconOpen] = useState(false);

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Pronunciation Lexicon</h3>
        <p className="text-sm text-muted-foreground">
          Manage global and book-specific pronunciation rules.
        </p>
        <Button onClick={() => setIsLexiconOpen(true)}>Manage Rules</Button>
        <LexiconManager open={isLexiconOpen} onOpenChange={setIsLexiconOpen} />
      </div>

      <div className="border-t pt-4 space-y-4">
        <h3 className="text-lg font-medium">Text Segmentation &amp; Abbreviations</h3>
        <p className="text-sm text-muted-foreground">
          Define abbreviations that should not trigger a sentence break, and enable built-in lexicon packs.
        </p>
        <TTSAbbreviationSettings />
      </div>
    </div>
  );
};

export default DictionaryPanel;
