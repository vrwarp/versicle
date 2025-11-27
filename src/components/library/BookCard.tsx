import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BookMetadata } from '../../types/db';
import { Card, CardContent } from '../ui/card';

interface BookCardProps {
  book: BookMetadata;
}

export const BookCard: React.FC<BookCardProps> = ({ book }) => {
  const navigate = useNavigate();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    if (book.coverBlob) {
      url = URL.createObjectURL(book.coverBlob);
      setCoverUrl(url);
    }

    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [book.coverBlob]);

  return (
    <Card
      onClick={() => navigate(`/read/${book.id}`)}
      className="group overflow-hidden cursor-pointer h-full hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-gray-200 dark:border-gray-800"
    >
      <div className="aspect-[2/3] w-full bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`Cover of ${book.title}`}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 dark:text-gray-700 bg-gray-50 dark:bg-gray-900">
            <span className="text-4xl font-serif italic">Aa</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
      </div>
      <CardContent className="p-4">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 line-clamp-2 mb-1 leading-tight" title={book.title}>
          {book.title}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1" title={book.author}>
          {book.author || 'Unknown Author'}
        </p>
      </CardContent>
    </Card>
  );
};
