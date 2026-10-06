/**
 * A poll: a question with options, published as one message in a group;
 * members vote with reactions, one emoji per option. Open until the post is
 * deleted - no deadlines. Pure data and rules - no I/O, no chat knowledge.
 *
 * Poll {id, question, options: string[], multiple, author: string, group: {id, name},
 *       commandItemId: number (the member's "/голосование" post), itemId: number|null (the bot's message),
 *       createdAt, ballots: {[memberKey]: {name, choices: number[], at}}}
 */

/**
 * Reactions the CLI accepts (single code points; the heart is left out because
 * the apps send it with a variation selector the CLI rejects). An option's
 * reaction is the one at its index.
 */
export const POLL_REACTIONS = Object.freeze(["👍", "😀", "😂", "🚀", "✅", "😢", "👎"])

/** Emoji as the apps send it (often with U+FE0F) -> the option index, or -1 */
export function optionOfReaction(emoji) {
  return POLL_REACTIONS.indexOf(String(emoji ?? "").replace(/️/gu, ""))
}

/**
 * Parses the text after "/голосование": "Вопрос? | вариант | вариант [несколько]".
 * @returns {{ok: true, question: string, options: string[], multiple: boolean} | {ok: false, error: "noSeparator"|"fewOptions"|"tooManyOptions"}}
 */
export function parsePoll(argument, maxOptions = POLL_REACTIONS.length) {
  let multiple = false
  const body = String(argument ?? "").replace(/(^|\s)(?:--?)?(?:несколько|multiple|multi)(?=\s|$)/giu, () => {
    multiple = true
    return " "
  })
  if (!body.includes("|")) return {ok: false, error: "noSeparator"}
  const parts = body.split("|").map((s) => s.replace(/\s+/g, " ").trim())
  const [question, ...options] = [parts[0], ...parts.slice(1).filter(Boolean)]
  if (!question || options.length < 2) return {ok: false, error: "fewOptions"}
  if (options.length > maxOptions) return {ok: false, error: "tooManyOptions"}
  return {ok: true, question, options, multiple}
}

export function newPoll({question, options, multiple, author, group, commandItemId, now = new Date()}) {
  return {id: null, question, options: [...options], multiple, author, group: {id: group.id, name: group.title ?? group.name}, commandItemId, itemId: null, createdAt: now.toISOString(), ballots: {}}
}

/**
 * A member's reaction added or removed. Single-choice polls keep the last
 * active choice; multiple-choice polls keep every active reaction.
 * @returns {boolean} whether the ballots changed
 */
export function castBallot(poll, memberKey, name, optionIndex, added, now = new Date()) {
  if (optionIndex < 0 || optionIndex >= poll.options.length) return false
  const current = poll.ballots[memberKey]?.choices ?? []
  const choices = added ? (poll.multiple ? [...new Set([...current, optionIndex])] : [optionIndex]) : current.filter((c) => c !== optionIndex)
  if (choices.length === current.length && choices.every((c, i) => c === current[i])) return false
  if (choices.length === 0) delete poll.ballots[memberKey]
  else poll.ballots[memberKey] = {name, choices, at: now.toISOString()}
  return true
}

/**
 * Rebuilds the ballots from who currently reacts with what (after the bot was away).
 * @param {Array<{option: number, members: Array<{key, name, at}>}>} reactions
 */
export function rebuildBallots(poll, reactions) {
  const latest = new Map() // key -> {name, choices: Map<option, at>}
  for (const {option, members} of reactions) {
    for (const m of members) {
      const entry = latest.get(m.key) ?? {name: m.name, choices: new Map()}
      entry.choices.set(option, m.at)
      latest.set(m.key, entry)
    }
  }
  poll.ballots = {}
  for (const [key, {name, choices}] of latest) {
    let picked = [...choices.entries()]
    if (!poll.multiple) picked = [picked.reduce((a, b) => (a[1] >= b[1] ? a : b))]
    poll.ballots[key] = {name, choices: picked.map(([o]) => o).sort((a, b) => a - b), at: picked.map(([, at]) => at).sort().at(-1)}
  }
}

/** @returns {{counts: number[], participants: number}} */
export function tally(poll) {
  const counts = poll.options.map(() => 0)
  const ballots = Object.values(poll.ballots)
  for (const b of ballots) for (const c of b.choices) counts[c]++
  return {counts, participants: ballots.length}
}
