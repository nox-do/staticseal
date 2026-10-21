// Creator UI policy, not technical payload-format or recipient-reader limits.
// The CLI defines its own product limits and explicitly opts into its compression range.
export const BROWSER_FILE_WARN_BYTES = 5 * 1024 * 1024;
export const BROWSER_FILE_CONFIRM_BYTES = 10 * 1024 * 1024;
export const BROWSER_FILE_MAX_BYTES = 25 * 1024 * 1024;
