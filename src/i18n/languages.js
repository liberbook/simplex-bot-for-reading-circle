import en from "./en.js"
import it from "./it.js"
import ru from "./ru.js"
import uk from "./uk.js"

/**
 * The languages the bot speaks. ADDING ONE: copy en.js, translate the values,
 * import it here and add it to the map below - nothing else in the code names
 * a language. `test/unit/i18n.test.js` then checks the new file for missing
 * keys and stray placeholders.
 *
 * This module holds no logic on purpose: the command parser needs the command
 * words without pulling in the message composer.
 */
export const LANGUAGES = Object.freeze({en, ru, uk, it})

export const DEFAULT_LANGUAGE = "en"

/** ["en (English)", "ru (Русский)", ...] - for --help and error messages. */
export const languageList = () => Object.entries(LANGUAGES).map(([code, l]) => `${code} (${l.name})`)

/**
 * Command words of EVERY language, so a member may type a command in their own
 * one whatever the group's configured language is.
 * @returns {{help: Set<string>, poll: Set<string>}}
 */
export function commandWords() {
  const merge = (kind) => new Set(Object.values(LANGUAGES).flatMap((l) => l.commandWords[kind]).map((w) => w.toLowerCase()))
  return {help: merge("help"), poll: merge("poll")}
}
