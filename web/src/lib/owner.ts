/**
 * Who "you" are and which workspaces form the control room, from the daemon's capabilities.
 * `owner_aliases` are lower-case names that mean the person running the app (default `me`), so a
 * ledger ball or note reading "me: merge #12" puts the ball in your court. `command_titles` are the
 * upper-case workspace titles configured as the control room.
 */
const DEFAULT_ALIASES = ['me'];
let aliases: string[] = DEFAULT_ALIASES;
let commandTitles = new Set<string>();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Applies `capabilities.owner_aliases` and `capabilities.command_titles`; anything malformed falls back to the defaults. */
export function setOwnerConfig(caps: { owner_aliases?: unknown; command_titles?: unknown } | null | undefined) {
  const a = Array.isArray(caps?.owner_aliases) ? caps!.owner_aliases.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
  aliases = a.length ? a.map((x) => x.trim().toLowerCase()) : DEFAULT_ALIASES;
  const t = Array.isArray(caps?.command_titles) ? caps!.command_titles.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
  commandTitles = new Set(t.map((x) => x.trim().toUpperCase()));
}

/** Text that starts with one of the owner's aliases ("me: merge #12", "Priya, review"), case-insensitive. */
export function isOwnerText(text: string | null | undefined): boolean {
  if (!text) return false;
  return new RegExp(`^(${aliases.map(escape).join('|')})\\b`, 'i').test(text.trim());
}

const COMMAND_RE = /^(control|command)\b/i;

/** A workspace title (or its prefix before " · ") that marks the control room. */
export function isCommandTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return commandTitles.has(title.trim().toUpperCase()) || COMMAND_RE.test(title);
}
