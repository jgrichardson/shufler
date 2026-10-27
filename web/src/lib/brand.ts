/**
 * The product's names, each defined once here (the daemon's copy is in daemon/shufler/config.py).
 * index.html's <title> and package.json's name are set by hand to match; the tab title is replaced at runtime.
 */
export const PRODUCT_NAME = 'Shufler';
/** The one-line description, used verbatim everywhere (index.html's meta description is set by hand to match). */
export const TAGLINE = 'A 3D control room for developers who run many AI coding agent sessions at once.';
/** The CLI command (bin/<CLI_NAME>), also the config dir name (~/.config/<CLI_NAME>). */
export const CLI_NAME = 'shufler';
/** Prefix for every localStorage key. */
export const STORAGE_PREFIX = 'shufler.';
/**
 * What the UI calls the optional external review bot (its verdict gate, ball and re-request lever).
 * Shown as-is in labels; change it here to name your own reviewer. The wire fields are `reviewer*` (CONTRACT.md).
 */
export const REVIEWER_NAME = 'Review bot';
