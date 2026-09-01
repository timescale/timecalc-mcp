declare const TIMECALC_VERSION: string | undefined;

/** Replaced by Bun's --define flag in release executables. */
export const VERSION =
  typeof TIMECALC_VERSION === "string" ? TIMECALC_VERSION : "0.0.0";
