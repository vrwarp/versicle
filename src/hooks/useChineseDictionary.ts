import { useState, useEffect } from 'react';
import { createLogger } from '../lib/logger';

const logger = createLogger('useChineseDictionary');

// Simple in-memory global cache to avoid refetching during session
let cachedDictionary: Record<string, [string, string]> | null = null;
let isFetching = false;

export function useChineseDictionary(isChineseBook: boolean) {
  const [dict, setDict] = useState<Record<string, [string, string]> | null>(cachedDictionary);

  useEffect(() => {
    if (!isChineseBook || dict || isFetching) return;

    isFetching = true;
    logger.debug('Loading CC-CEDICT dictionary dynamically...');

    fetch('/dict/cedict.json')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        cachedDictionary = data;
        setDict(data);
        isFetching = false;
        logger.debug('CC-CEDICT dictionary loaded successfully');
      })
      .catch((err) => {
        logger.error('Failed to load Chinese dictionary', err);
        isFetching = false;
      });
  }, [isChineseBook, dict]);

  return { dict };
}
