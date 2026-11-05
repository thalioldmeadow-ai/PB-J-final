/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public RevenueCat Web Billing SDK key. Safe to ship to the browser. */
  readonly VITE_REVENUECAT_WEB_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
