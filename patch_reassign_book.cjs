const fs = require('fs');
let content = fs.readFileSync('src/components/notes/ReassignBookDialog.tsx', 'utf8');

const replacement = `    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearchQuery = useDebounce(searchQuery, 300);

    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (isOpen) {
            setSelectedBookId('');
            setSearchQuery('');
        }
    }`;

const toReplace = `    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearchQuery = useDebounce(searchQuery, 300);

    useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedBookId('');
            setSearchQuery('');
        }
    }, [isOpen]);`;

content = content.replace(toReplace, replacement);
content = content.replace(/, useEffect/g, '');
fs.writeFileSync('src/components/notes/ReassignBookDialog.tsx', content);
