import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Fix: Define process.env.API_KEY for client-side access, as required by Gemini API guidelines.
  // It uses the value from the VITE_API_KEY environment variable.
  define: {
    // Fix: Use index access for `VITE_API_KEY` to avoid TypeScript errors. This is necessary
    // because a global type declaration in `src/env.d.ts` narrows the `process.env` type
    // for client-side code, which would otherwise cause a type error in this Node.js context.
    'process.env.API_KEY': JSON.stringify(process.env['VITE_API_KEY'])
  }
})
