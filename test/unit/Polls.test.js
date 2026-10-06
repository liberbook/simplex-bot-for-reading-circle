import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {Polls} from "../../src/bot/Polls.js"
import {PollStore} from "../../src/storage/PollStore.js"
import {ALICE, BOB, FakeGateway, GROUP, groupMessage, silentLogger, texts} from "./helpers.js"

function setup() {
  const gateway = new FakeGateway()
  const store = new PollStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "conatus-")), "polls.json"))
  const timers = []
  const polls = new Polls({gateway, store, texts, logger: silentLogger, trigger: "conatus", setTimer: (fn, ms) => (timers.push({fn, ms}), timers.length), clearTimer: (id) => (timers[id - 1] = null)})
  const fire = async () => {
    for (const t of timers.splice(0)) if (t) await t.fn()
  }
  return {gateway, store, polls, fire}
}

test("a poll is one message answering the command; reactions become votes and edit that message once per burst", async () => {
  const {gateway, store, polls, fire} = setup()
  assert.equal(await polls.handle(groupMessage({itemId: 40, text: "/vote When shall we meet? | Saturday | Sunday"})), true)
  assert.deepEqual(gateway.sent, [{chat: GROUP, text: "When shall we meet?\n\n👍 Saturday\n😀 Sunday\n\nChoose one option with a reaction.", quotedItemId: 40}])
  const poll = store.list()[0]
  assert.equal(poll.itemId, 100)
  assert.equal(poll.commandItemId, 40)
  assert.equal(poll.author, "alice")
  await polls.onReaction({chat: GROUP, itemId: 100, sender: ALICE, emoji: "👍", added: true})
  await polls.onReaction({chat: GROUP, itemId: 100, sender: BOB, emoji: "😀️", added: true})
  await polls.onReaction({chat: GROUP, itemId: 100, sender: BOB, emoji: "❤️", added: true}) // not an option
  await polls.onReaction({chat: GROUP, itemId: 555, sender: BOB, emoji: "👍", added: true}) // not a poll
  assert.deepEqual(gateway.edits, [], "edits are debounced")
  await fire()
  assert.deepEqual(gateway.edits, [{chat: {type: "group", id: 1, name: "Ethics"}, itemId: 100, text: "When shall we meet?\n\n👍 Saturday · 1\n😀 Sunday · 1\n\nChoose one option with a reaction.\n2 votes"}])
  await polls.onReaction({chat: GROUP, itemId: 100, sender: BOB, emoji: "😀", added: false})
  await fire()
  assert.match(gateway.edits.at(-1).text, /😀 Sunday · 0\n\nChoose one option with a reaction\.\n1 vote$/)
})

test("errors are answered with one hint; 'несколько' allows several choices", async () => {
  const {gateway, polls} = setup()
  await polls.handle(groupMessage({itemId: 41, text: "/v When shall we meet"}))
  await polls.handle(groupMessage({itemId: 42, text: "/vote When? | Sat"}))
  assert.deepEqual(gateway.sent.map((m) => [m.quotedItemId, m.text.split("\n")[0]]), [[41, "Separate the question and the options with |:"], [42, "I need a question and at least two options:"]])
  await polls.handle(groupMessage({itemId: 43, text: "/v What shall we read? | Part 1 | Part 2 multiple"}))
  assert.match(gateway.sent.at(-1).text, /You can choose several options with reactions\.$/)
  assert.equal(await polls.handle(groupMessage({text: "vote without a slash | a | b"})), false)
})

test("deleting the member's post removes the poll and the bot's message; deleting the bot's message just forgets the poll", async () => {
  const {gateway, store, polls} = setup()
  await polls.handle(groupMessage({itemId: 40, text: "/v A? | b | c"}))
  await polls.handle(groupMessage({itemId: 45, text: "/v B? | b | c"}))
  await polls.onMessageDeleted(groupMessage({itemId: 40, text: "/v A? | b | c"}))
  assert.deepEqual(gateway.deletions, [{chat: GROUP, itemId: 100}])
  assert.deepEqual(store.list().map((p) => p.question), ["B?"])
  await polls.onMessageDeleted(groupMessage({itemId: 101, incoming: false, text: "B?"})) // a moderator removed the bot's message
  assert.deepEqual(store.list(), [])
  assert.equal(gateway.deletions.length, 1, "nothing left to delete")
  await polls.onMessageDeleted(groupMessage({itemId: 999})) // unrelated post
})

test("after a restart the ballots are rebuilt from the reactions the CLI knows", async () => {
  const {gateway, store, polls} = setup()
  await polls.handle(groupMessage({itemId: 40, text: "/v A? | b | c"}))
  gateway.reactions["1:100:👍"] = [{name: "alice", memberId: 2, at: "2026-09-12T10:00:00Z"}, {name: "carol", memberId: 7, at: "2026-09-12T10:01:00Z"}]
  gateway.reactions["1:100:😀"] = [{name: "alice", memberId: 2, at: "2026-09-12T10:02:00Z"}]
  await polls.start()
  assert.deepEqual(Object.values(store.list()[0].ballots).map((b) => [b.name, b.choices]), [["alice", [1]], ["carol", [0]]])
  assert.match(gateway.edits.at(-1).text, /👍 b · 1\n😀 c · 1\n\n[^\n]*\n2 votes$/)
})
