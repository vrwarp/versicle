import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BookMetadata } from '../../../../types/db';
import { MoreVertical, Trash2, CloudOff } from 'lucide-react';
import { useLibraryStore } from '../../../../store/useLibraryStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../ui/DropdownMenu';
import { cn } from '../../../../lib/utils';

interface ModernCardViewProps {
  book: BookMetadata;
  style?: React.CSSProperties;
}

export const ModernCardView: React.FC<ModernCardViewProps> = React.memo(({ book, style }) => {
  const navigate = useNavigate();
  const { removeBook, offloadBook, restoreBook } = useLibraryStore();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let url: string | null = null;
    if (book.coverBlob) {
      url = URL.createObjectURL(book.coverBlob);
      setCoverUrl(url);
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [book.coverBlob]);

  const handleCardClick = () => {
    if (book.isOffloaded) {
      fileInputRef.current?.click();
    } else {
      navigate(`/read/${book.id}`);
    }
  };

  const handleOffload = (e: React.MouseEvent) => {
    e.stopPropagation();
    offloadBook(book.id);
  };

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
       restoreBook(book.id, e.target.files[0]);
    }
  };

  return (
    <div
      style={style}
      onClick={handleCardClick}
      className="group relative flex flex-col rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden bg-card cursor-pointer border border-border/50"
    >
      <input type="file" ref={fileInputRef} onChange={handleRestore} className="hidden" accept=".epub" />

      {/* Cover Image - Larger/Prominent */}
      <div className="aspect-[2/3] w-full relative overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={book.title}
            className={cn(
                "w-full h-full object-cover transition-transform duration-500 group-hover:scale-105",
                book.isOffloaded && 'opacity-50 grayscale'
            )}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
            <span className="text-5xl font-light">Aa</span>
          </div>
        )}
      </div>

      {/* Modern Typography */}
      <div className="p-4 flex flex-col gap-1">
        <h3 className="text-lg font-bold leading-tight text-foreground line-clamp-2 group-hover:text-primary transition-colors">
          {book.title}
        </h3>
        <p className="text-base text-muted-foreground font-medium line-clamp-1">
          {book.author}
        </p>
      </div>

       {/* Menu */}
       <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
           <DropdownMenu>
             <DropdownMenuTrigger asChild>
               <button className="p-2 rounded-full bg-black/60 text-white hover:bg-black/80" onClick={e => e.stopPropagation()}>
                  <MoreVertical className="w-4 h-4" />
               </button>
             </DropdownMenuTrigger>
             <DropdownMenuContent>
                <DropdownMenuItem onClick={handleOffload}>
                    <CloudOff className="w-4 h-4 mr-2" /> Offload
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); removeBook(book.id); }} className="text-destructive">
                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                </DropdownMenuItem>
             </DropdownMenuContent>
           </DropdownMenu>
       </div>
    </div>
  );
});
