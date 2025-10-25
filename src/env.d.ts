// This file fixes the "Cannot redeclare block-scoped variable 'process'" error.
// The error likely occurs because another dependency (e.g., @types/node) already defines a global `process` variable.
// Instead of redeclaring `process`, we augment the existing `NodeJS.ProcessEnv` interface
// to add the `API_KEY` property. This provides type safety for the environment variable
// injected by Vite without creating a conflict.

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      API_KEY: string;
    }
  }
}

// Adding this empty export turns the file into a module, which is necessary
// for `declare global` to work correctly and augment the global scope.
export {};
