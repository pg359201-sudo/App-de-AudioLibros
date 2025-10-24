// Fix: The reference to "vite/client" was causing a build error.
// It is commented out because the project does not use import.meta.env, so the types are not strictly necessary.
// /// <reference types="vite/client" />

declare namespace NodeJS {
  interface ProcessEnv {
    readonly API_KEY: string;
  }
}
