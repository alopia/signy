/** False in production builds, so dev only checks and warnings drop out. Set by tsup and vitest. */
declare const __DEV__: boolean;

/** Framework version, set at build time from package.json. */
declare const __VERSION__: string;
