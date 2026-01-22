/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SDK_KEY: string;
  readonly VITE_SDK_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
