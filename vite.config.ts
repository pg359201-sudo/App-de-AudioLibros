import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Fix: Define process.env.API_KEY for client-side access, as required by Gemini API guidelines.
  // It uses the value from the VITE_API_KEY environment variable.
  define: {
    'process.env.API_KEY': JSON.stringify(process.env.VITE_API_KEY)
  }
})
