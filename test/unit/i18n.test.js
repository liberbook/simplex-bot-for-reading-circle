import test from "node:test"
import assert from "node:assert/strict"
import en from "../../src/i18n/en.js"
import {DEFAULT_LANGUAGE, LANGUAGES, texts} from "../../src/i18n/index.js"
import {Kind, parseCommand} from "../../src/domain/Command.js"
import {POLL_REACTIONS, parsePoll} from "../../src/domain/Poll.js"

const CODES = Object.keys(LANGUAGES)
const FORMS = {simple: 2, slavic: 3}

test("English is the default and the template every language follows", () => {
  assert.equal(DEFAULT_LANGUAGE, "en")
  assert.equal(LANGUAGES.en, en)
})

for (const code of CODES) {
  const language = LANGUAGES[code]

  test(`${code}: the same keys as en.js, nothing missing and nothing extra`, () => {
    assert.deepEqual(Object.keys(language).sort(), Object.keys(en).sort())
    assert.deepEqual(Object.keys(language.commandWords).sort(), Object.keys(en.commandWords).sort())
    for (const [key, value] of Object.entries(language)) assert.equal(typeof value, typeof en[key], `${code}.${key}`)
  })

  test(`${code}: the plural rule matches the number of forms`, () => {
    assert.ok(language.pluralRule in FORMS, `${code}: unknown pluralRule "${language.pluralRule}"`)
    assert.equal(language.votes.length, FORMS[language.pluralRule])
    const counts = [0, 1, 2, 5, 11, 21, 101].map((n) => texts("conatus", code).poll({question: "q", options: ["a", "b"], multiple: false}, {counts: [n, 0], participants: n}))
    for (const text of counts) assert.doesNotMatch(text, /\{/, "no placeholder left in a poll")
  })

  test(`${code}: every text is filled in - no {placeholder} survives`, () => {
    const t = texts("conatus", code)
    const all = [t.help(), t.botCommands(), t.noFileInPost(), t.whichFile(), t.unknownPost(), t.stillDownloading("a.pdf"), t.notKept("a.pdf"), t.archiveFull(), t.pollError("noSeparator"), t.pollError("fewOptions"), t.pollError("tooManyOptions")]
    for (const text of all) {
      assert.equal(typeof text, "string")
      assert.ok(text.length > 0)
      assert.doesNotMatch(text, /\{\w+\}/, `${code}: unfilled placeholder in «${text}»`)
    }
    assert.match(t.help(), /conatus/, "the help names the trigger word")
    assert.match(t.whichFile(), /conatus/)
    assert.match(t.stillDownloading("a.pdf"), /a\.pdf/)
    assert.match(t.notKept("a.pdf"), /a\.pdf/)
    assert.match(t.pollError("tooManyOptions"), new RegExp(String(POLL_REACTIONS.length)))
  })

  test(`${code}: the commands its texts show really work, in any group`, () => {
    for (const word of language.commandWords.help) assert.equal(parseCommand(`/${word}`, "conatus").kind, Kind.HELP, `/${word}`)
    for (const word of language.commandWords.poll) assert.equal(parseCommand(`/${word} Q? | a | b`, "conatus").kind, Kind.POLL, `/${word}`)
    // the poll command as the help spells it, with the example the error messages give
    const command = parseCommand(`/${language.pollCommand} Q? | a | b`, "conatus")
    assert.equal(command.kind, Kind.POLL)
    assert.equal(parsePoll(command.argument).ok, true)
    const example = texts("conatus", code).pollError("noSeparator").split("\n").at(-1)
    const parsed = parseCommand(example, "conatus")
    assert.equal(parsed.kind, Kind.POLL, `the example in the error message must be a real command: ${example}`)
    assert.equal(parsePoll(parsed.argument).ok, true, `the example must parse as a poll: ${example}`)
  })
}

test("an unknown language is refused by name", () => {
  assert.throws(() => texts("conatus", "de"), /unknown language "de"/)
})

test("a member may write the command in any language, whatever the group speaks", () => {
  for (const code of CODES) {
    const word = LANGUAGES[code].pollCommand
    assert.equal(parseCommand(`/${word} Q? | a | b`, "conatus").kind, Kind.POLL, `/${word} must work everywhere`)
  }
})
