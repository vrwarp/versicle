# **Setup & Scaffold Implementation**

## **1. Introduction**
This document provides the step-by-step instructions to initialize the Versicle repository, ensuring all dependencies and configurations are in place for the subsequent development steps.

## **2. Prerequisites**
*   **Node.js:** v18+
*   **npm:** v9+

## **3. Project Initialization**

### **3.1 Create Vite App**
Execute the following commands in the root of the repository (or the desired parent folder if starting fresh, but assuming repo root for this agent context):

```bash
# If the directory is empty or we are initializing inside the current repo
npm create vite@latest . -- --template react-ts
# If prompted to remove existing files (like README/plan), be careful.
# Better to use a specific name if creating a subfolder, but instructions imply root.
# Assuming we are in the repo root and it's safe to overwrite/add package.json:
```

### **3.2 Install Dependencies**

**Core:**
```bash
npm install react react-dom zustand idb epubjs uuid clsx react-router-dom
```

**Dev Dependencies:**
```bash
npm install -D typescript @types/react @types/react-dom @vitejs/plugin-react vite @types/uuid @types/node
# Note: @types/epubjs might be outdated or missing. We may need a custom declaration file.
```

## **4. Configuration**

### **4.1 TypeScript (`tsconfig.json`)**
Ensure `strict: true` is enabled. Add paths if we want aliases (e.g., `@/*` -> `src/*`), but relative imports are fine for this scale.

### **4.2 Vite (`vite.config.ts`)**
Standard React configuration.

### **4.3 ESLint/Prettier**
Set up basic linting rules to ensure code quality.

## **5. Directory Structure Creation**

Run the following command to create the folder structure defined in `step01.md`:

```bash
mkdir -p src/assets
mkdir -p src/components/ui
mkdir -p src/components/library
mkdir -p src/components/reader
mkdir -p src/db
mkdir -p src/hooks
mkdir -p src/lib
mkdir -p src/store
mkdir -p src/types
```

## **6. Initial Files**

### **6.1 Type Definitions**
Create `src/types/epubjs.d.ts` if types are missing (likely needed).
```typescript
declare module 'epubjs' {
    const ePub: any;
    export default ePub;
}
// We will refine this as we go.
```

### **6.2 Database Entry Point**
Create `src/db/db.ts` (Empty for now, just the file).

### **6.3 Main Entry**
Modify `src/main.tsx` to include `BrowserRouter` (if using react-router).

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
```

## **7. Verification**
1.  Run `npm install`.
2.  Run `npm run dev`.
3.  Check localhost to see the default Vite + React app.

## **8. Next Steps**
Proceed to **Step 1: Skeleton & Database** implementation.
