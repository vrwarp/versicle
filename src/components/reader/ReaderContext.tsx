import React, { createContext, useContext, type ReactNode } from 'react';
import type { Book, Rendition } from 'epubjs';

interface ReaderContextProps {
  book: Book | null;
  rendition: Rendition | null;
  setBook: (book: Book | null) => void;
  setRendition: (rendition: Rendition | null) => void;
}

const ReaderContext = createContext<ReaderContextProps | undefined>(undefined);

export const ReaderProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [book, setBook] = React.useState<Book | null>(null);
  const [rendition, setRendition] = React.useState<Rendition | null>(null);

  return (
    <ReaderContext.Provider value={{ book, rendition, setBook, setRendition }}>
      {children}
    </ReaderContext.Provider>
  );
};

export const useReaderContext = () => {
  const context = useContext(ReaderContext);
  if (context === undefined) {
    throw new Error('useReaderContext must be used within a ReaderProvider');
  }
  return context;
};
