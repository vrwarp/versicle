import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BookMetadata } from '../../../../types/db';

interface MinimalRowViewProps {
  book: BookMetadata;
  style: React.CSSProperties;
}

export const MinimalRowView: React.FC<MinimalRowViewProps> = React.memo(({ book, style }) => {
  const navigate = useNavigate();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    if (book.coverBlob) {
      url = URL.createObjectURL(book.coverBlob);
      setCoverUrl(url);
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [book.coverBlob]);

  return (
    <div
        style={style}
        className="flex items-center gap-4 px-4 py-2 hover:bg-accent/50 cursor-pointer transition-colors border-b border-border/40"
        onClick={() => navigate(`/read/${book.id}`)}
    >
      <div className="h-12 w-12 rounded bg-muted overflow-hidden flex-shrink-0">
          {coverUrl ? (
              <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
              <div className="h-full w-full flex items-center justify-center text-xs">Aa</div>
          )}
      </div>
      <div className="flex flex-col">
          <span className="text-lg font-medium text-foreground">{book.title}</span>
          <span className="text-sm text-muted-foreground">{book.author}</span>
      </div>
    </div>
  );
});
