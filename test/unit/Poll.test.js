import test from "node:test"
import assert from "node:assert/strict"
import {castBallot, newPoll, optionOfReaction, parsePoll, rebuildBallots, tally} from "../../src/domain/Poll.js"

test("parsePoll: question and options separated by |, an optional 'несколько'", () => {
  assert.deepEqual(parsePoll("Когда? | Сб | Вс"), {ok: true, question: "Когда?", options: ["Сб", "Вс"], multiple: false})
  assert.deepEqual(parsePoll("Что читать? | Э1 | Э2 | Э3 несколько"), {ok: true, question: "Что читать?", options: ["Э1", "Э2", "Э3"], multiple: true})
  assert.deepEqual(parsePoll("Когда встречаемся"), {ok: false, error: "noSeparator"})
  assert.deepEqual(parsePoll("Когда? | Сб"), {ok: false, error: "fewOptions"})
  assert.deepEqual(parsePoll("| a | b"), {ok: false, error: "fewOptions"})
  assert.equal(parsePoll("Q | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8").error, "tooManyOptions")
})

test("ballots: single choice keeps the last reaction, multiple keeps all; rebuild from the reactions the CLI knows", () => {
  const poll = newPoll({question: "Q", options: ["a", "b", "c"], multiple: false, author: "alice", group: {id: 1, name: "ethics", title: "Ethics"}, commandItemId: 5, now: new Date("2026-09-12T10:00:00Z")})
  assert.equal(poll.group.name, "Ethics")
  assert.equal(castBallot(poll, "m1", "alice", 0, true), true)
  assert.equal(castBallot(poll, "m1", "alice", 2, true), true, "a second reaction replaces the first")
  assert.deepEqual(poll.ballots.m1.choices, [2])
  assert.equal(castBallot(poll, "m1", "alice", 2, true), false, "no change")
  assert.equal(castBallot(poll, "m2", "bob", 9, true), false, "not an option")
  castBallot(poll, "m2", "bob", 2, true)
  assert.deepEqual(tally(poll), {counts: [0, 0, 2], participants: 2})
  castBallot(poll, "m2", "bob", 2, false)
  assert.equal(poll.ballots.m2, undefined, "withdrawn")
  const multi = {...poll, multiple: true, ballots: {}}
  castBallot(multi, "m1", "alice", 0, true)
  castBallot(multi, "m1", "alice", 2, true)
  assert.deepEqual(multi.ballots.m1.choices, [0, 2])
  rebuildBallots(poll, [{option: 0, members: [{key: "m1", name: "alice", at: "2026-09-12T10:00:00Z"}]}, {option: 1, members: [{key: "m1", name: "alice", at: "2026-09-12T10:05:00Z"}, {key: "m3", name: "carol", at: "2026-09-12T10:01:00Z"}]}])
  assert.deepEqual(tally(poll), {counts: [0, 2, 0], participants: 2}, "single choice: the latest reaction wins")
  assert.equal(optionOfReaction("😀"), 1)
  assert.equal(optionOfReaction("😀️"), 1, "the apps' variation selector is ignored")
  assert.equal(optionOfReaction("❤️"), -1)
})
