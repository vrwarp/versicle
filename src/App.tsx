import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Library } from './components/library/Library';
import { Reader } from './components/reader/Reader';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-background text-foreground">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/book/:id" element={<Reader />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
