import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BookMetadata } from '../../../../types/db';
import { Button } from '../../../ui/Button';
import { BookOpen } from 'lucide-react';

interface HeroCardViewProps {
  book: BookMetadata;
}

export const HeroCardView: React.FC<HeroCardViewProps> = ({ book }) => {
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
    <div className="w-full bg-card rounded-2xl overflow-hidden shadow-2xl mb-8 border border-border/50 relative group">
        {/* Background Blur Effect */}
        <div
            className="absolute inset-0 opacity-10 blur-3xl scale-110 pointer-events-none"
            style={{
                backgroundImage: coverUrl ? `url(${coverUrl})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center'
            }}
        />

        <div className="flex flex-col md:flex-row gap-8 p-8 relative z-10">
            {/* Cover */}
            <div
                className="flex-shrink-0 w-48 md:w-64 aspect-[2/3] rounded-lg shadow-xl overflow-hidden cursor-pointer hover:scale-105 transition-transform duration-300"
                onClick={() => navigate(`/read/${book.id}`)}
            >
                {coverUrl ? (
                    <img src={coverUrl} alt={book.title} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                        <BookOpen className="w-12 h-12 text-muted-foreground" />
                    </div>
                )}
            </div>

            {/* Details */}
            <div className="flex flex-col justify-center gap-4 flex-1">
                <div className="space-y-2">
                    <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground">{book.title}</h2>
                    <p className="text-xl md:text-2xl text-muted-foreground font-light">{book.author}</p>
                </div>

                {book.description && (
                    <p className="text-muted-foreground line-clamp-3 md:line-clamp-4 max-w-2xl">
                        {book.description}
                    </p>
                )}

                <div className="flex gap-4 mt-4">
                    <Button size="lg" onClick={() => navigate(`/read/${book.id}`)} className="gap-2">
                        <BookOpen className="w-5 h-5" />
                        Read Now
                    </Button>
                    {/* Add more actions if needed */}
                </div>

                {book.progress !== undefined && book.progress > 0 && (
                     <div className="max-w-md space-y-2">
                        <div className="flex justify-between text-sm text-muted-foreground">
                            <span>Progress</span>
                            <span>{Math.round(book.progress * 100)}%</span>
                        </div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${book.progress * 100}%` }} />
                        </div>
                     </div>
                )}
            </div>
        </div>
    </div>
  );
};
