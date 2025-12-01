import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { LibraryView } from './components/library/LibraryView';
import { ReaderView } from './components/reader/ReaderView';
import { ThemeSynchronizer } from './components/ThemeSynchronizer';
import { GlobalSettingsDialog } from './components/ui/GlobalSettingsDialog';
import { useUIStore } from './store/useUIStore';

function App() {
  const { isGlobalSettingsOpen, setGlobalSettingsOpen } = useUIStore();

  return (
    <Router>
      <ThemeSynchronizer />
      <GlobalSettingsDialog open={isGlobalSettingsOpen} onOpenChange={setGlobalSettingsOpen} />
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
