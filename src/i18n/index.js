import {POLL_REACTIONS} from "../domain/Poll.js"
import {DEFAULT_LANGUAGE, LANGUAGES} from "./languages.js"

export {DEFAULT_LANGUAGE, LANGUAGES, languageList} from "./languages.js"

/** How a count is spelled; a language file names the rule it needs. */
const PLURAL_RULES = {
  simple: (n) => (n === 1 ? 0 : 1),
  slavic: (n) => {
    const m10 = n % 10
    const m100 = n % 100
    return m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2
  },
}

/** "{name} is still downloading" + {name: "a.pdf"} -> "a.pdf is still downloading" */
export const fill = (template, values) => String(template).replace(/\{(\w+)\}/g, (whole, key) => (key in values ? values[key] : whole))

/**
 * Every text the bot sends, built from one language file. Pure functions: data
 * in, string out. The bot classes see only this object, never a language file.
 *
 * @param {string} trigger the configured word that asks for a file
 * @param {string} [language] a key of LANGUAGES
 */
export function texts(trigger, language = DEFAULT_LANGUAGE) {
  const s = LANGUAGES[language]
  if (!s) throw new Error(`unknown language "${language}" (known: ${Object.keys(LANGUAGES).join(", ")})`)
  const plural = (n) => `${n} ${s.votes[PLURAL_RULES[s.pluralRule](n)]}`
  return {
    /** "/?" in the group, any private message, the greeting when the bot joins a group */
    help: () => fill(s.help, {trigger}),
    /** the command menu the chat apps show for the bot (see bots/README in simplex-chat) */
    botCommands: () => `'${s.menuHelp}':/?,'${s.menuPoll}':/'${s.pollCommand} ${s.menuPollArgs}'`,

    // ---- files ----
    noFileInPost: () => s.noFileInPost,
    whichFile: () => fill(s.whichFile, {trigger}),
    unknownPost: () => s.unknownPost,
    stillDownloading: (name) => fill(s.stillDownloading, {name}),
    notKept: (name) => fill(s.notKept, {name}),
    archiveFull: () => s.archiveFull,

    // ---- polls ----
    pollError: (error) =>
      ({
        noSeparator: s.pollNoSeparator,
        fewOptions: s.pollFewOptions,
        tooManyOptions: fill(s.pollTooManyOptions, {max: POLL_REACTIONS.length}),
      })[error],
    poll(poll, {counts, participants}) {
      const options = poll.options.map((o, i) => `${POLL_REACTIONS[i]} ${o}${participants > 0 ? ` · ${counts[i]}` : ""}`)
      return [poll.question, "", ...options, "", poll.multiple ? s.pollPickMany : s.pollPickOne, ...(participants > 0 ? [plural(participants)] : [])].join("\n")
    },
  }
}
