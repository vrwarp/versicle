const fs = require('fs');
let content = fs.readFileSync('src/components/ui/CompassPill.tsx', 'utf8');

const replacement = `  // Reset editing state when variant changes
  const [prevVariant, setPrevVariant] = useState(variant);
  if (variant !== prevVariant) {
    setPrevVariant(variant);
    setIsEditingNote(false);
    setNoteText('');
  }`;

const toReplace = `  // Reset editing state when variant changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsEditingNote(false);
    setNoteText('');
  }, [variant]);`;

content = content.replace(toReplace, replacement);
fs.writeFileSync('src/components/ui/CompassPill.tsx', content);
