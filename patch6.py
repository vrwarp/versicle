import re

with open('src/lib/tts/AudioContentPipeline.ts', 'r') as f:
    content = f.read()

# Add genAIService import back
import_stmt = "import { genAIService } from '../genai/GenAIService';\n"
content = re.sub(
    r"import \{ useGenAIStore \} from '\.\./\.\./store/useGenAIStore';\n",
    r"import { useGenAIStore } from '../../store/useGenAIStore';\n" + import_stmt,
    content
)

with open('src/lib/tts/AudioContentPipeline.ts', 'w') as f:
    f.write(content)
