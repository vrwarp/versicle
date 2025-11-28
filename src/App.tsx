import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { LibraryView } from './components/library/LibraryView';
import { ReaderView } from './components/reader/ReaderView';
import { ThemeSynchronizer } from './components/ThemeSynchronizer';

function App() {
  return (
    <Router>
      <ThemeSynchronizer />
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
