import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { LibraryView } from './components/library/LibraryView';
import { ReaderView } from './components/reader/ReaderView';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-background text-foreground">
        <Routes>
          <Route path="/" element={<LibraryView />} />
          <Route path="/read/:id" element={<ReaderView />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
