import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useReaderStore } from '../../store/useReaderStore';

export const Reader: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { setCurrentBookId } = useReaderStore();

  React.useEffect(() => {
    if (id) {
      setCurrentBookId(id);
    }
    return () => setCurrentBookId(null);
  }, [id, setCurrentBookId]);

  return (
    <div className="h-screen flex flex-col">
      <div className="p-2 border-b flex justify-between items-center">
        <Link to="/" className="text-blue-500 hover:underline">Back to Library</Link>
        <span className="font-semibold">Reader (Book ID: {id})</span>
        <div>Controls Placeholder</div>
      </div>
      <div className="flex-1 bg-gray-100 flex items-center justify-center">
        <p>EPUB Content will be rendered here.</p>
      </div>
    </div>
  );
};
