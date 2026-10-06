import {commandWords} from "../i18n/languages.js"

/**
 * What a group message asks of the bot. Three things exist, nothing else:
 *   HELP    "/?" (also "/??" and each language's word: "/help", "/aiuto", ...)
 *   POLL    "/vote <question> | <option> | <option>" (also "/poll", "/голосование", ...)
 *   FETCH   the trigger word alone ("conatus", punctuation aside) - "send me this file"
 * A command starts with a slash; the trigger word is the one bare word. Any
 * other text is conversation and gets no answer. Pure function, no I/O.
 *
 * The words of EVERY language are accepted whatever the configured one is, so a
 * member may type the command in their own language (i18n/languages.js).
 */
export const Kind = Object.freeze({HELP: "help", POLL: "poll", FETCH: "fetch", NONE: "none"})

const WORDS = commandWords()
const HELP_WORDS = new Set(["?", "??", ...WORDS.help])
const POLL_WORDS = WORDS.poll

/**
 * @param {string} text the message
 * @param {string} trigger the trigger word from the configuration
 * @returns {{kind: string, argument: string}}
 */
export function parseCommand(text, trigger) {
  const trimmed = String(text ?? "").trim()
  if (isBareWord(trimmed, trigger)) return {kind: Kind.FETCH, argument: ""}
  if (!trimmed.startsWith("/")) return {kind: Kind.NONE, argument: ""}
  const [word, ...rest] = trimmed.slice(1).split(/\s+/)
  const w = word.toLowerCase()
  if (HELP_WORDS.has(w)) return {kind: Kind.HELP, argument: ""}
  if (POLL_WORDS.has(w)) return {kind: Kind.POLL, argument: rest.join(" ").trim()}
  return {kind: Kind.NONE, argument: ""}
}

/** "conatus", "Conatus!", "conatus." - the word and nothing but punctuation around it. */
export function isBareWord(text, word) {
  const pattern = new RegExp(`^[^\\p{L}\\p{N}]*${escape(word)}[^\\p{L}\\p{N}]*$`, "iu")
  return pattern.test(String(text ?? ""))
}

/** Group name pattern from the configuration: "*" matches any part of the name, case-insensitively. */
export function groupMatches(pattern, group) {
  const re = new RegExp(`^${escape(pattern).replaceAll("\\*", ".*")}$`, "iu")
  return re.test(group.title ?? "") || re.test(group.name ?? "")
}

function escape(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
