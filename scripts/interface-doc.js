#!/usr/bin/env node
// Generates INTERFACE.md: everything the bot says, with the message that
// provokes it. The bot's own classes run against the test gateway, so the
// document cannot drift from the code (test/unit/interface.test.js checks
// that the committed file is what this script produces).
//
//   node scripts/interface-doc.js            -> writes INTERFACE.md in the repo root
//   node scripts/interface-doc.js /dev/stdout
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {FakeGateway, GROUP, silentLogger} from "../test/unit/helpers.js"
import {Message} from "../src/domain/Message.js"
import {Folder} from "../src/storage/Folder.js"
import {PollStore} from "../src/storage/PollStore.js"
import {LANGUAGES, texts as makeTexts} from "../src/i18n/index.js"
import {Keeper} from "../src/bot/Keeper.js"
import {Courier} from "../src/bot/Courier.js"
import {Polls} from "../src/bot/Polls.js"
import {Helper} from "../src/bot/Helper.js"

const ROOT = path.resolve(import.meta.dirname, "..")
const TRIGGER = "conatus"
const NOW = new Date("2026-09-16T09:00:00Z")
const SAM = {contactId: 3, name: "sam", memberId: 2}
const LENA = {contactId: null, name: "lena", memberId: 7}
const DIRECT = {type: "direct", id: 3, name: "sam"}

/**
 * The bot as main.js wires it, on the test gateway: real folders in a
 * temporary directory, no network, timers fired by hand.
 */
function bench() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conatus-doc-"))
  const gateway = new FakeGateway({groups: [GROUP]})
  const texts = makeTexts(TRIGGER)
  const archive = new Folder(path.join(dir, "files"))
  const deleted = new Folder(path.join(dir, "deleted"))
  archive.ensure()
  deleted.ensure()
  const timers = []
  const fireTimers = async () => {
    for (const t of timers.splice(0)) if (t) await t()
  }
  const keeper = new Keeper({gateway, archive, deleted, texts, logger: silentLogger, maxBytes: 100 * 1024, retentionMs: 30 * 86_400_000, clock: () => NOW})
  const courier = new Courier({gateway, keeper, texts, logger: silentLogger, trigger: TRIGGER})
  const polls = new Polls({gateway, store: new PollStore(path.join(dir, "state", "polls.json")), texts, logger: silentLogger, trigger: TRIGGER, clock: () => NOW, setTimer: (fn) => timers.push(fn), clearTimer: (id) => (timers[id - 1] = null)})
  const helper = new Helper({gateway, texts, logger: silentLogger, trigger: TRIGGER})

  let itemId = 100
  const route = async (message) => {
    // the same order as Bot.#routeMessage
    if (message.isDirect) return helper.handle(message)
    await keeper.handle(message)
    if (!(await courier.handle(message)) && !(await polls.handle(message))) await helper.handle(message)
  }
  /** Everything the bot sent, edited or deleted while `fn` ran. */
  const capture = async (fn) => {
    const sent = gateway.sent.length
    const edited = gateway.edits.length
    const deletions = gateway.deletions.length
    await fn()
    const out = gateway.sent.slice(sent)
    for (const edit of gateway.edits.slice(edited)) out.push({...edit, edited: true})
    for (const d of gateway.deletions.slice(deletions)) out.push({...d, deleted: true})
    return out
  }
  /** A file the CLI has finished downloading into the archive. */
  const kept = (name, size) => {
    fs.writeFileSync(path.join(archive.dir, name), Buffer.alloc(size))
    return {id: itemId++, name, size, status: "rcvComplete", path: path.join(archive.dir, name), contentType: "file"}
  }
  /** A post in the group the bot can look up (by id, and among the recent messages). */
  const post = (sender, text, file = null) => {
    const message = new Message({chat: GROUP, sender, incoming: true, itemId: itemId++, text, file, sentAt: NOW})
    gateway.items[`${GROUP.id}:${message.itemId}`] = message
    gateway.recent.push(message)
    return message
  }

  return {
    texts, gateway, keeper, courier, polls, helper, fireTimers, kept, post,
    priv: (text) => capture(() => route(new Message({chat: DIRECT, sender: SAM, incoming: true, itemId: itemId++, text}))),
    grp: (text, {sender = SAM, file = null, quotedItemId = null, isReply = quotedItemId !== null} = {}) => capture(() => route(post(sender, text, file) && new Message({chat: GROUP, sender, incoming: true, itemId: itemId - 1, text, file, quotedItemId, isReply, sentAt: NOW}))),
    capture,
    lastItemId: () => gateway.nextItemId - 1,
  }
}

/** What the bot did, as a person in the chat sees it. */
function render(entries) {
  if (entries.length === 0) return "(the bot says nothing)"
  return entries
    .map((e) => {
      if (e.filePath) return `[the bot sends the file ${path.basename(e.filePath)} as a reply]`
      if (e.edited) return `[the bot rewrites its own message]\n${e.text}`
      if (e.deleted) return "[the bot deletes its own message]"
      const where = e.chat.type === "direct" ? "[into the private chat]" : e.quotedItemId ? "[as a reply]" : "[into the group]"
      return `${where}\n${e.text}`
    })
    .join("\n\n")
}

export async function generate() {
  const b = bench()
  const out = []
  const md = (...lines) => out.push(lines.join("\n"))
  const h1 = (t) => md(`# ${t}`, "")
  const h2 = (t) => md(`## ${t}`, "")
  const p = (t) => md(t, "")
  const ex = (title, entries, note = null) => md(`**${title}**${note ? ` - ${note}` : ""}`, "", "```text", render(entries), "```", "")

  h1("What the bot says")
  p(
    [
      "Generated from the code: the messages below are produced by the very classes the",
      "bot runs (`scripts/interface-doc.js`), so they are what a member really sees.",
      "Regenerate with `npm run doc`; `test/unit/interface.test.js` fails when this file",
      "falls behind the code.",
    ].join("\n")
  )
  p(
    [
      "The examples use the default language (English) - the same texts exist in every",
      `language of \`src/i18n/\` (${Object.entries(LANGUAGES).map(([code, l]) => `${code} ${l.name}`).join(", ")}).`,
      "Setting: group \"Ethics\", trigger word `conatus`, archive limit 100 KiB; `sam` and",
      "`lena` are members of the group.",
    ].join("\n")
  )
  p(["1. [Help](#help)", "2. [Files](#files)", "3. [Polls](#polls)", "4. [What the bot leaves alone](#what-the-bot-leaves-alone)", "5. [The command menu](#the-command-menu)"].join("\n"))

  h2("Help")
  p("One help text, in three places: any private message, `/?` in the group, and the greeting when the bot joins a group.")
  ex("Someone connects to the bot", await b.capture(() => b.gateway.sendText(DIRECT, b.texts.help())), "the first message in the private chat")
  ex("Any private message, e.g. \"hello\"", await b.priv("hello"))
  ex("`/?` in the group", await b.grp("/?"), "also `/??` and each language's word: `/help`, `/aiuto`, `/помощь`, `/довідка`")
  ex("The bot joined a group", await b.capture(() => b.helper.greet(GROUP)))

  h2("Files")
  p("Every file posted in the group is downloaded silently - the caption plays no part. A file comes back on the trigger word: as a reply to the post with it, or as a bare word right under it.")
  const report = b.post(LENA, "", b.kept("report.pdf", 40 * 1024))
  ex("lena posts report.pdf", [], "the bot keeps the file and says nothing")
  ex("`conatus` as a reply to the post with report.pdf", await b.grp("conatus", {quotedItemId: report.itemId}))
  ex("`Conatus!` - case and punctuation do not matter", await b.grp("Conatus!", {quotedItemId: report.itemId}))
  ex("`conatus` as a message right under the file", await b.grp("conatus"), "no reply link (that is how the apps send comments) - the latest posted file is meant")
  const talk = b.post(LENA, "Let us read the third part.")
  ex("`conatus` as a reply to a post without a file", await b.grp("conatus", {quotedItemId: talk.itemId}))
  b.gateway.recent.length = 0
  ex("`conatus` with no file anywhere near", await b.grp("conatus"), "neither a reply nor a file among the last 20 messages")
  const loading = {id: 900, name: "lecture.mp3", size: 50 * 1024, status: "rcvInvitation", path: null, contentType: "file"}
  const loadingPost = b.post(LENA, "", loading)
  await b.keeper.handle(loadingPost)
  ex("`conatus` on a file that is still downloading", await b.grp("conatus", {quotedItemId: loadingPost.itemId}))
  const lost = b.post(LENA, "", {id: 901, name: "old.pdf", size: 1024, status: "rcvComplete", path: "/data/files/old.pdf", contentType: "file"})
  ex("`conatus` on a file the bot does not have", await b.grp("conatus", {quotedItemId: lost.itemId}), "the download failed, or the file has left the archive")
  ex("`conatus` as a reply to a post older than the bot's history", await b.grp("conatus", {isReply: true}), "the bot never received that post (it joined later) and does not guess which file was meant")
  b.gateway.recent.length = 0
  b.post(LENA, "", b.kept("earlier.pdf", 2 * 1024))
  b.gateway.recent.push(new Message({chat: GROUP, sender: LENA, incoming: true, itemId: 950, text: "", file: b.kept("removed.pdf", 2 * 1024), deleted: true, sentAt: NOW}))
  ex("`conatus` as a bare word when the latest file post was deleted", await b.grp("conatus"), "deleted posts are skipped - the file before it comes back")
  ex("A file that does not fit the archive", await b.grp("", {sender: LENA, file: {id: 902, name: "big.zip", size: 60 * 1024, status: "rcvInvitation", path: null, contentType: "file"}}), "the only thing the bot says of its own accord while keeping files")
  ex("A post with a file is deleted for everyone", [], "the bot moves the file to the deleted folder without a word; it is purged after 30 days")

  h2("Polls")
  p("One command in the group; the bot answers with one message and edits it as the reactions come in (a burst of reactions makes one edit). A poll lives as long as the author's post and the bot's message.")
  let entries = await b.grp("/vote When shall we meet? | Saturday | Sunday")
  ex("`/vote When shall we meet? | Saturday | Sunday`", entries, "also `/poll`, `/v`, and each language's word: `/sondaggio`, `/голосование`, `/голосування`")
  const pollId = b.lastItemId()
  ex("sam reacts 👍, lena reacts 😀", await b.capture(async () => {
    await b.polls.onReaction({chat: GROUP, itemId: pollId, sender: SAM, emoji: "👍", added: true})
    await b.polls.onReaction({chat: GROUP, itemId: pollId, sender: LENA, emoji: "😀", added: true})
    await b.fireTimers()
  }))
  ex("sam moves the reaction to 😀", await b.capture(async () => {
    await b.polls.onReaction({chat: GROUP, itemId: pollId, sender: SAM, emoji: "😀", added: true})
    await b.fireTimers()
  }), "an ordinary poll counts the last choice")
  ex("lena takes the reaction back", await b.capture(async () => {
    await b.polls.onReaction({chat: GROUP, itemId: pollId, sender: LENA, emoji: "😀", added: false})
    await b.fireTimers()
  }))
  const multi = await b.grp("/v What shall we read? | Part 1 | Part 2 | Part 3 multiple")
  ex("`/v What shall we read? | Part 1 | Part 2 | Part 3 multiple`", multi, "the word `multiple` anywhere in the command lets everyone choose several options")
  const multiId = b.lastItemId()
  ex("sam reacts 👍 and 😂", await b.capture(async () => {
    await b.polls.onReaction({chat: GROUP, itemId: multiId, sender: SAM, emoji: "👍", added: true})
    await b.polls.onReaction({chat: GROUP, itemId: multiId, sender: SAM, emoji: "😂", added: true})
    await b.fireTimers()
  }))
  const command = b.gateway.recent.findLast((m) => m.text.startsWith("/v What shall we read?"))
  ex("The author deletes their post with the command", await b.capture(() => b.polls.onMessageDeleted(command)), "the bot's message goes with it")
  ex("An owner deletes the bot's message", await b.capture(() => b.polls.onMessageDeleted(new Message({chat: GROUP, sender: {contactId: null, name: "me"}, incoming: false, itemId: pollId, text: ""}))), "the poll is forgotten; there is nothing left to write to")
  ex("`/vote When shall we meet`", await b.grp("/vote When shall we meet"))
  ex("`/vote When? | Saturday`", await b.grp("/vote When? | Saturday"))
  ex("`/vote How many? | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8`", await b.grp("/vote How many? | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8"))

  h2("What the bot leaves alone")
  p("The group is a conversation between people. A command starts with `/`; the one bare word is the trigger, and only on its own.")
  entries = []
  for (const text of ["Spinoza writes about conatus in the third part.", "vote When? | Sat | Sun", "/unknown", "help", "conatus est essentia"]) entries.push(...(await b.grp(text)))
  ex("\"Spinoza writes about conatus in the third part.\", \"vote When? | Sat | Sun\", `/unknown`, \"help\", \"conatus est essentia\"", entries)
  ex("A file captioned `conatus`", await b.grp("conatus", {sender: LENA, file: {id: 903, name: "notes.txt", size: 1024, status: "rcvInvitation", path: null, contentType: "file"}}), "kept like any other file; the word in a caption asks for nothing")
  ex("Commands and `conatus` in the group history the bot receives when it joins", [], "files from the history are kept, but nothing is answered")
  ex("An invitation to a group whose name does not match the `group` setting", [], "the bot does not join")

  h2("The command menu")
  p("What the chat apps show in the bot's command menu (`/set bot commands`), one line per language:")
  md("```text", ...Object.keys(LANGUAGES).map((code) => `${code}  ${makeTexts(TRIGGER, code).botCommands()}`), "```", "")

  return out.join("\n").trimEnd() + "\n"
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const target = process.argv[2] ?? path.join(ROOT, "INTERFACE.md")
  fs.writeFileSync(target, await generate())
  if (target !== "/dev/stdout") console.log(`written: ${target}`)
}
