/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PARTY_HOST?: string;
  // VITE_ADMIN_TOKEN intentionally removed: it would be inlined into the
  // public JS bundle. Admin token validation is now server-side only.
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
