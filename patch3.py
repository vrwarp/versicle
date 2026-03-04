import re

with open('src/lib/tts/AudioContentPipeline.ts', 'r') as f:
    content = f.read()

# Add import for TableAdaptationProcessor
import_stmt = "import { TableAdaptationProcessor } from './TableAdaptationProcessor';\n"
content = re.sub(
    r"import \{ LexiconService \} from '\./LexiconService';\n",
    r"import { LexiconService } from './LexiconService';\n" + import_stmt,
    content
)

# Add member variable
content = re.sub(
    r'private lastAbbrResult: string\[\] \| null = null;\n',
    r'private lastAbbrResult: string[] | null = null;\n\n    private tableProcessor = new TableAdaptationProcessor();\n',
    content
)

# Use member variable in processTableAdaptations
content = re.sub(
    r'this\.processTableAdaptations\(bookId, sectionId, targetSentences, onAdaptationsFound\)',
    r'this.tableProcessor.processTableAdaptations(bookId, sectionId, targetSentences, onAdaptationsFound)',
    content
)

# Use member variable in preprocessTableRoots
content = re.sub(
    r'const preprocessedTableRoots = this\.preprocessTableRoots\(sectionTableImages\);',
    r'const preprocessedTableRoots = this.tableProcessor.preprocessTableRoots(sectionTableImages);',
    content
)

# Remove processTableAdaptations
content = re.sub(
    r'    async processTableAdaptations\([\s\S]*?}\n    }\n\n    /\*\*',
    r'    /**',
    content,
    flags=re.DOTALL
)

# Remove mapSentencesToAdaptations
content = re.sub(
    r'    public mapSentencesToAdaptations\([\s\S]*?}\n    }\n\n    /\*\*',
    r'    /**',
    content,
    flags=re.DOTALL
)

# Remove preprocessTableRoots
content = re.sub(
    r'    private preprocessTableRoots\([\s\S]*?}\n    }\n\n    /\*\*',
    r'    /**',
    content,
    flags=re.DOTALL
)

with open('src/lib/tts/AudioContentPipeline.ts', 'w') as f:
    f.write(content)
