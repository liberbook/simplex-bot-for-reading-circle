#!/usr/bin/env node
// End-to-end scenario against the Docker network (see docker/compose.yml):
// three simulated users (alice, bob, carol) driven through their own
// simplex-chat CLIs, the bot on its own CLI, local relays only.
//
// alice creates the group "Ethics" and invites the bot and bob; carol never
// joins. Every file posted in the group must land in the bot's archive
// silently; "conatus" as a reply (or a bare comment under a file) brings the
// file back; the 100 KiB limit is enforced; polls are voted by reactions and
// die with their post; every private message is answered with the help; a
// group whose name does not match is ignored.
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import {ChatPeer, sleep} from "./ChatPeer.js"

const env = (name, fallback) => {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`missing env ${name}`)
  return v
}
const cfg = {
  botName: env("BOT_NAME", "conatus"),
  group: env("GROUP", "Ethics"),
  botAddressFile: env("BOT_ADDRESS_FILE"),
  botFiles: env("BOT_FILES"),
  botDeleted: env("BOT_DELETED"),
  botPolls: env("BOT_POLLS"),
  aliceWs: env("ALICE_WS"),
  bobWs: env("BOB_WS"),
  carolWs: env("CAROL_WS"),
  aliceFiles: env("ALICE_FILES"), // alice's files folder as the runner sees it
  cliFiles: env("CLI_FILES"), // ...and as alice's CLI sees it
  bobFiles: env("BOB_FILES"),
}

// the default language (English); the bot's config in docker/conatus.test.json sets none
const HELP = [
  "I keep every file this group shares.",
  "To get a file back, reply conatus to the post with it - I will send it back.",
  "",
  "Poll: /vote Question? | Option 1 | Option 2",
  "People vote with reactions. Delete your post and the poll is gone.",
].join("\n")

const t0 = Date.now()
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${m}`)
let passed = 0

async function step(name, fn) {
  log(`---- ${name}`)
  try {
    await fn()
    passed++
    log(`PASS  ${name}`)
  } catch (e) {
    log(`FAIL  ${name}\n       ${e.message}`)
    throw e
  }
}

const randomFile = (dir, name, size) => {
  const bytes = crypto.randomBytes(size)
  fs.writeFileSync(path.join(dir, name), bytes)
  return bytes
}

async function waitFor(description, check, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await check()
    if (result) return result
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${description}`)
    await sleep(1000)
  }
}

const archivedBytes = (name) => {
  const p = path.join(cfg.botFiles, name)
  return fs.existsSync(p) ? fs.readFileSync(p) : null
}
const namesIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile()).sort() : [])
const archiveNames = () => namesIn(cfg.botFiles)
const deletedNames = () => namesIn(cfg.botDeleted)
const pollQuestions = () => {
  try {
    return Object.values(JSON.parse(fs.readFileSync(cfg.botPolls, "utf8")).polls ?? {}).map((p) => p.question)
  } catch {
    return []
  }
}

const composed = (msgContent, extra = {}) => JSON.stringify([{msgContent, mentions: {}, ...extra}])
/** Posts a file to the group and waits until the sender's CLI finished uploading it to the relay. */
async function sendGroupFile(peer, groupId, fileName, caption, extra = {}) {
  const sent = await peer.expect(`/_send #${groupId} json ${composed({type: "file", text: caption}, {fileSource: {filePath: path.join(cfg.cliFiles, fileName)}, ...extra})}`, ["newChatItems"], 60_000)
  const isOurs = (e) => e.chatItem?.chatItem?.file?.fileName === fileName
  const ev = await peer.waitEvent(`${peer.name}: upload of ${fileName}`, (e) => (e.type === "sndFileCompleteXFTP" || e.type === "sndFileError" || e.type === "sndFileWarning") && isOurs(e), 120_000)
  if (ev.type !== "sndFileCompleteXFTP") throw new Error(`${peer.name}: upload of ${fileName} failed: ${JSON.stringify(ev).slice(0, 400)}`)
  return sent.chatItems[0].chatItem.meta.itemId
}
const sendGroupText = async (peer, groupId, text, extra = {}) => (await peer.expect(`/_send #${groupId} json ${composed({type: "text", text}, extra)}`, ["newChatItems"])).chatItems[0].chatItem.meta.itemId
const sendDirectText = (peer, contactId, text) => peer.expect(`/_send @${contactId} json ${composed({type: "text", text})}`, ["newChatItems"])
const botSays = (peer, description, predicate, timeoutMs = 60_000) => peer.waitDirectText(description, predicate, {from: cfg.botName, timeoutMs})
/** How many times the bot has sent `text` to `peer` privately (waits match past events too, so equal texts are counted). */
const directCount = (peer, text) => peer.events.flatMap((e) => (e.type === "newChatItems" ? e.chatItems : [])).filter(({chatInfo, chatItem}) => chatItem.chatDir?.type === "directRcv" && chatInfo.contact?.localDisplayName === cfg.botName && chatItem.content?.msgContent?.text === text).length
/** The bot's text in the group; with `replyTo` only a message answering (quoting) that item counts, so equal texts never get mixed up. */
async function botPosts(peer, description, predicate, {replyTo = undefined, timeoutMs = 60_000} = {}) {
  const item = await peer.waitGroupItem(description, (ci) => ci.content?.msgContent?.type === "text" && predicate(ci.content.msgContent.text) && (replyTo === undefined || ci.quotedItem?.itemId === replyTo), {from: cfg.botName, timeoutMs})
  return item.content.msgContent.text
}
/** The item id under which `peer` sees a message another member posted (ids differ per database). */
const itemIdOnPeer = (peer, description, predicate) => peer.waitGroupItem(description, predicate).then((ci) => ci.meta.itemId)
/** Every text the bot posted in the group so far, as `peer` saw it. */
const botTextsSeen = (peer) => peer.events.flatMap((e) => (e.type === "newChatItems" ? e.chatItems : [])).filter(({chatItem}) => chatItem.chatDir?.type === "groupRcv" && chatItem.chatDir.groupMember?.localDisplayName === cfg.botName && chatItem.content?.type === "rcvMsgContent").map(({chatItem}) => chatItem.content.msgContent?.text ?? `[${chatItem.content.msgContent?.type}]`)
/** Downloads a file the bot offered in the group and returns its bytes. */
async function download(peer, fileName, offerItem) {
  const fileId = offerItem.file.fileId
  await peer.expect(`/freceive ${fileId} approved_relays=on`, ["rcvFileAccepted"], 60_000)
  const done = await peer.waitEvent(`${peer.name}: download of ${fileName}`, (e) => e.type === "rcvFileComplete" && e.chatItem.chatItem.file.fileId === fileId, 120_000)
  return fs.readFileSync(path.join(cfg.bobFiles, path.basename(done.chatItem.chatItem.file.fileSource.filePath)))
}
/** The file the bot sends back: a file offer from the bot member, as a reply to `replyTo`. */
async function botSendsFile(peer, fileName, replyTo) {
  return peer.waitGroupItem(`${peer.name}: ${fileName} from the bot as a reply to ${replyTo}`, (ci) => ci.file?.fileName === fileName && ci.file?.fileStatus?.type === "rcvInvitation" && ci.quotedItem?.itemId === replyTo, {from: cfg.botName, timeoutMs: 120_000})
}
const reaction = (peer, groupId, itemId, emoji, on) => peer.expect(`/_reaction #${groupId} ${itemId} ${on ? "on" : "off"} ${JSON.stringify({type: "emoji", emoji})}`, ["chatItemReaction"])
const pollEdited = (peer, description, predicate, timeoutMs = 30_000) => peer.waitEvent(description, (e) => e.type === "chatItemUpdated" && e.chatItem?.chatItem?.chatDir?.type === "groupRcv" && predicate(e.chatItem.chatItem.content?.msgContent?.text ?? ""), timeoutMs)

/** Polls the member list until `memberName` is a connected member (group messages only reach connected members). */
const waitMemberConnected = (peer, groupId, memberName) =>
  waitFor(`${peer.name}: ${memberName} connected in group`, async () => {
    const r = await peer.expect(`/_members #${groupId}`, ["groupMembers"])
    return r.group.members.some((m) => m.localDisplayName === memberName && m.memberStatus === "connected")
  })

async function main() {
  const [alice, bob, carol] = await Promise.all([ChatPeer.connect("alice", cfg.aliceWs), ChatPeer.connect("bob", cfg.bobWs), ChatPeer.connect("carol", cfg.carolWs)])
  const peers = [alice, bob, carol]
  const state = {}

  await step("CLIs are up with profiles", async () => {
    for (const p of peers) {
      const r = await p.expect("/user", ["activeUser"])
      if (r.user.profile.displayName !== p.name) throw new Error(`${p.name} has profile ${r.user.profile.displayName}`)
    }
  })

  await step("bot published its address", async () => {
    state.botAddress = await waitFor("bot address file", () => (fs.existsSync(cfg.botAddressFile) ? fs.readFileSync(cfg.botAddressFile, "utf8").trim() : null), 180_000)
    log(`bot address: ${state.botAddress.slice(0, 60)}...`)
  })

  await step("everyone who connects to the bot gets the help as the first message", async () => {
    state.botContact = {}
    for (const p of peers) {
      await p.expect(`/c ${state.botAddress}`, ["sentInvitation", "sentConfirmation"], 60_000)
      const ev = await p.waitEvent(`${p.name}: connected to bot`, (e) => e.type === "contactConnected" && e.contact.localDisplayName === cfg.botName)
      state.botContact[p.name] = ev.contact.contactId
      await botSays(p, `${p.name}: greeting`, (t) => t === HELP, 90_000)
    }
  })

  await step("any private message, from anyone, is answered with the same help", async () => {
    await sendDirectText(carol, state.botContact.carol, "hello, what can you do?")
    await waitFor("carol: help for plain words", () => directCount(carol, HELP) >= 2)
    await sendDirectText(carol, state.botContact.carol, "/vote When? | Sat | Sun")
    await waitFor("carol: help for a poll command", () => directCount(carol, HELP) >= 3)
    await sleep(2000)
    const others = carol.events.flatMap((e) => (e.type === "newChatItems" ? e.chatItems : [])).filter(({chatItem}) => chatItem.chatDir?.type === "directRcv" && chatItem.content?.type === "rcvMsgContent" && chatItem.content.msgContent?.text !== HELP)
    if (others.length > 0) throw new Error(`carol got something else privately: ${JSON.stringify(others.map((i) => i.chatItem.content?.msgContent?.text))}`)
  })

  await step("an invitation to a group whose name does not match is ignored", async () => {
    const g = await carol.expect("/g Random", ["groupCreated"])
    await carol.expect(`/a Random ${cfg.botName} member`, ["sentGroupInvitation"])
    await sleep(6000)
    const r = await carol.expect(`/_members #${g.groupInfo.groupId}`, ["groupMembers"])
    const bot = r.group.members.find((m) => m.localDisplayName === cfg.botName)
    if (!bot || bot.memberStatus !== "invited") throw new Error(`bot member status in carol's group: ${bot?.memberStatus}`)
  })

  await step("alice and bob become contacts", async () => {
    const inv = await alice.expect("/c", ["invitation"])
    await bob.expect(`/c ${inv.connLinkInvitation.connFullLink}`, ["sentConfirmation", "sentInvitation"], 60_000)
    await alice.waitEvent("alice: bob connected", (e) => e.type === "contactConnected" && e.contact.localDisplayName === "bob")
    await bob.waitEvent("bob: alice connected", (e) => e.type === "contactConnected" && e.contact.localDisplayName === "alice")
  })

  await step("alice creates the group; the bot joins when invited by a plain member, greets once and ignores the old history", async () => {
    const g = await alice.expect(`/g ${cfg.group}`, ["groupCreated"])
    state.groupIdAlice = g.groupInfo.groupId
    // a command or the trigger word already in the history must not be answered when the bot receives that history
    await sendGroupText(alice, state.groupIdAlice, "/?")
    await sendGroupText(alice, state.groupIdAlice, "conatus")
    await sleep(1000)
    await alice.expect(`/a ${cfg.group} ${cfg.botName} member`, ["sentGroupInvitation"])
    await alice.waitEvent("alice: bot joined", (e) => e.type === "joinedGroupMember" && e.member.localDisplayName === cfg.botName, 90_000)
    await botPosts(alice, "alice: group greeting", (t) => t === HELP)
    await sleep(5000)
    const texts = botTextsSeen(alice)
    if (texts.length !== 1) throw new Error(`the bot answered the history: ${JSON.stringify(texts)}`)
  })

  await step("bob joins the group and connects to the bot member", async () => {
    await alice.expect(`/a ${cfg.group} bob member`, ["sentGroupInvitation"])
    const inv = await bob.waitEvent("bob: group invitation", (e) => e.type === "receivedGroupInvitation")
    state.groupIdBob = inv.groupInfo.groupId
    await bob.expect(`/_join #${state.groupIdBob}`, ["userAcceptedGroupSent"])
    await alice.waitEvent("alice: bob joined", (e) => e.type === "joinedGroupMember" && e.member.localDisplayName === "bob", 90_000)
    await waitMemberConnected(bob, state.groupIdBob, cfg.botName)
    await waitMemberConnected(alice, state.groupIdAlice, "bob")
  })

  await step("conatus with no file anywhere near: the bot asks which file, as a reply", async () => {
    const id = await sendGroupText(bob, state.groupIdBob, "conatus")
    await botPosts(bob, "bob: which file", (t) => t === "Which file? Reply conatus to the post with the file.", {replyTo: id})
  })

  await step("every posted file is kept, silently: no caption, a caption, a Cyrillic name", async () => {
    fs.mkdirSync(cfg.aliceFiles, {recursive: true})
    const before = botTextsSeen(bob).length
    state.report = randomFile(cfg.aliceFiles, "report.pdf", 40 * 1024)
    state.notes = randomFile(cfg.aliceFiles, "notes.txt", 8 * 1024)
    state.cyrillicName = "Гольбах. Система природы.pdf"
    state.cyrillic = randomFile(cfg.aliceFiles, state.cyrillicName, 8 * 1024)
    await sendGroupFile(alice, state.groupIdAlice, "report.pdf", "")
    await sendGroupFile(alice, state.groupIdAlice, "notes.txt", "fyi, just some notes")
    await sendGroupFile(alice, state.groupIdAlice, state.cyrillicName, "")
    for (const [name, bytes] of [["report.pdf", state.report], ["notes.txt", state.notes], [state.cyrillicName, state.cyrillic]]) {
      await waitFor(`${name} in the archive`, () => archivedBytes(name)?.length === bytes.length, 120_000)
      if (!archivedBytes(name).equals(bytes)) throw new Error(`${name}: archived bytes differ`)
    }
    state.reportItemBob = await itemIdOnPeer(bob, "bob: sees report.pdf", (ci) => ci.file?.fileName === "report.pdf")
    state.notesItemBob = await itemIdOnPeer(bob, "bob: sees notes.txt", (ci) => ci.file?.fileName === "notes.txt")
    state.cyrillicItemBob = await itemIdOnPeer(bob, "bob: sees the Cyrillic file", (ci) => ci.file?.fileName === state.cyrillicName)
    await sleep(3000)
    const texts = botTextsSeen(bob).slice(before)
    if (texts.length > 0) throw new Error(`the bot spoke while keeping files: ${JSON.stringify(texts)}`)
  })

  await step("conatus in a reply to a file post: the file comes back as a reply, bytes intact", async () => {
    const id = await sendGroupText(bob, state.groupIdBob, "conatus", {quotedItemId: state.reportItemBob})
    const offer = await botSendsFile(bob, "report.pdf", id)
    if (!(await download(bob, "report.pdf", offer)).equals(state.report)) throw new Error("the returned file differs from the original")
  })

  await step("Conatus! with punctuation and a capital letter also works; a Cyrillic name survives the round trip", async () => {
    const id = await sendGroupText(bob, state.groupIdBob, "Conatus!", {quotedItemId: state.cyrillicItemBob})
    const offer = await botSendsFile(bob, state.cyrillicName, id)
    if (!(await download(bob, state.cyrillicName, offer)).equals(state.cyrillic)) throw new Error("the returned file differs from the original")
  })

  await step("a bare conatus right after a file refers to that file (the apps' comments carry no reply link)", async () => {
    const bytes = randomFile(cfg.aliceFiles, "comment.pdf", 4 * 1024)
    state.commentItemAlice = await sendGroupFile(alice, state.groupIdAlice, "comment.pdf", "")
    await bob.waitFileOffer("comment.pdf", "groupRcv")
    await waitFor("comment.pdf in the archive", () => archivedBytes("comment.pdf")?.length === bytes.length, 120_000)
    const id = await sendGroupText(bob, state.groupIdBob, "conatus")
    const offer = await botSendsFile(bob, "comment.pdf", id)
    if (!(await download(bob, "comment.pdf", offer)).equals(bytes)) throw new Error("the returned file differs from the original")
  })

  await step("conatus in a reply to a text post: one line, no file", async () => {
    await sendGroupText(alice, state.groupIdAlice, "Let us read the third part.")
    const postBob = await itemIdOnPeer(bob, "bob: sees alice's text", (ci) => ci.content?.msgContent?.text === "Let us read the third part.")
    const id = await sendGroupText(bob, state.groupIdBob, "conatus", {quotedItemId: postBob})
    await botPosts(bob, "bob: no file in that post", (t) => t === "There is no file in that post.", {replyTo: id})
  })

  await step("the group is a conversation: sentences, words without a slash, unknown commands and a captioned file get no answer", async () => {
    const before = botTextsSeen(bob).length
    state.captioned = randomFile(cfg.aliceFiles, "captioned.pdf", 4 * 1024)
    await sendGroupFile(alice, state.groupIdAlice, "captioned.pdf", "conatus") // the trigger in a caption: the file is kept like any other, nothing is sent back
    await waitFor("captioned.pdf in the archive", () => archivedBytes("captioned.pdf")?.length === state.captioned.length, 120_000)
    for (const text of ["Spinoza writes about conatus in the third part.", "vote When? | Sat | Sun", "/unknown", "conatus est essentia", "help"]) await sendGroupText(bob, state.groupIdBob, text)
    await sleep(5000)
    const texts = botTextsSeen(bob).slice(before)
    if (texts.length > 0) throw new Error(`the bot answered plain talk: ${JSON.stringify(texts)}`)
  })

  await step("/? in the group: the help, as a reply", async () => {
    const id = await sendGroupText(bob, state.groupIdBob, "/?")
    await botPosts(bob, "bob: group help", (t) => t === HELP, {replyTo: id})
  })

  await step("a file beyond the storage limit is refused with one line; conatus on it says it was not kept", async () => {
    // 40 + 8 + 8 + 4 + 4 = 64 KiB kept; 40 KiB more would exceed the 100 KiB limit
    randomFile(cfg.aliceFiles, "big.bin", 40 * 1024)
    state.bigItemAlice = await sendGroupFile(alice, state.groupIdAlice, "big.bin", "")
    await botPosts(alice, "alice: refusal", (t) => t === "File not kept: the archive is full.", {replyTo: state.bigItemAlice})
    await sleep(2000)
    if (archiveNames().includes("big.bin")) throw new Error("big.bin was archived")
    const bigItemBob = await itemIdOnPeer(bob, "bob: sees big.bin", (ci) => ci.file?.fileName === "big.bin")
    const id = await sendGroupText(bob, state.groupIdBob, "conatus", {quotedItemId: bigItemBob})
    await botPosts(bob, "bob: not kept", (t) => t === "big.bin was not kept: the download failed or the file is already gone.", {replyTo: id})
  })

  await step("a post deleted for everyone takes its file to the deleted folder", async () => {
    await alice.expect(`/_delete item #${state.groupIdAlice} ${state.commentItemAlice} broadcast`, ["chatItemsDeleted"])
    await waitFor("comment.pdf moved out of the archive", () => !fs.existsSync(path.join(cfg.botFiles, "comment.pdf")) && deletedNames().includes("comment.pdf"))
    if (!fs.readFileSync(path.join(cfg.botDeleted, "comment.pdf")).length) throw new Error("deleted copy is empty")
  })

  await step("a bare conatus skips deleted posts: the previous file comes back, not «big.bin was not kept»", async () => {
    await alice.expect(`/_delete item #${state.groupIdAlice} ${state.bigItemAlice} broadcast`, ["chatItemsDeleted"]) // the latest file post is now a deleted one
    await bob.waitEvent("bob: big.bin post deleted", (e) => e.type === "chatItemsDeleted" && (e.chatItemDeletions ?? []).some((d) => d.deletedChatItem?.chatItem?.file?.fileName === "big.bin"))
    const id = await sendGroupText(bob, state.groupIdBob, "conatus")
    const offer = await botSendsFile(bob, "captioned.pdf", id)
    if (!(await download(bob, "captioned.pdf", offer)).equals(state.captioned)) throw new Error("the returned file differs from the original")
  })

  await step("a poll: one message answering the command; reactions become votes, a single-choice poll keeps the last one", async () => {
    state.pollCmdBob = await sendGroupText(bob, state.groupIdBob, "/vote When shall we meet? | Saturday | Sunday")
    const text = "When shall we meet?\n\n👍 Saturday\n😀 Sunday\n\nChoose one option with a reaction."
    await botPosts(bob, "bob: poll posted", (t) => t === text, {replyTo: state.pollCmdBob})
    state.pollItemAlice = await itemIdOnPeer(alice, "alice: sees the poll", (ci) => ci.content?.msgContent?.text === text)
    await reaction(alice, state.groupIdAlice, state.pollItemAlice, "👍", true)
    await pollEdited(bob, "bob: one vote", (t) => t === "When shall we meet?\n\n👍 Saturday · 1\n😀 Sunday · 0\n\nChoose one option with a reaction.\n1 vote")
    await reaction(alice, state.groupIdAlice, state.pollItemAlice, "😀", true) // a second reaction in a single-choice poll replaces the first
    await pollEdited(bob, "bob: vote moved", (t) => t === "When shall we meet?\n\n👍 Saturday · 0\n😀 Sunday · 1\n\nChoose one option with a reaction.\n1 vote")
    const pollItemBob = await itemIdOnPeer(bob, "bob: poll item id", (ci) => ci.content?.msgContent?.text === text)
    await reaction(bob, state.groupIdBob, pollItemBob, "👍", true)
    await pollEdited(alice, "alice: two votes", (t) => t === "When shall we meet?\n\n👍 Saturday · 1\n😀 Sunday · 1\n\nChoose one option with a reaction.\n2 votes")
    await reaction(bob, state.groupIdBob, pollItemBob, "👍", false)
    await pollEdited(alice, "alice: vote withdrawn", (t) => t === "When shall we meet?\n\n👍 Saturday · 0\n😀 Sunday · 1\n\nChoose one option with a reaction.\n1 vote")
    const questions = pollQuestions()
    if (!questions.includes("When shall we meet?")) throw new Error(`polls.json: ${questions}`)
  })

  await step("poll mistakes get one hint each: no separator, one option, too many options", async () => {
    let id = await sendGroupText(bob, state.groupIdBob, "/vote When shall we meet")
    await botPosts(bob, "bob: no separator", (t) => t === "Separate the question and the options with |:\n/vote When shall we meet? | Saturday | Sunday", {replyTo: id})
    id = await sendGroupText(bob, state.groupIdBob, "/v When? | Sat")
    await botPosts(bob, "bob: one option", (t) => t === "I need a question and at least two options:\n/vote When shall we meet? | Saturday | Sunday", {replyTo: id})
    id = await sendGroupText(bob, state.groupIdBob, "/v How many? | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8")
    await botPosts(bob, "bob: too many", (t) => t === "No more than 7 options.", {replyTo: id})
  })

  await step("a multiple-choice poll counts every reaction of a member; a command word of another language works too", async () => {
    // "/sondaggio" is Italian, the group speaks English: every language's command words are accepted
    state.multiCmdBob = await sendGroupText(bob, state.groupIdBob, "/sondaggio What shall we read? | Part 1 | Part 2 | Part 3 multiple")
    const text = "What shall we read?\n\n👍 Part 1\n😀 Part 2\n😂 Part 3\n\nYou can choose several options with reactions."
    await botPosts(bob, "bob: multiple-choice poll", (t) => t === text, {replyTo: state.multiCmdBob})
    state.multiItemAlice = await itemIdOnPeer(alice, "alice: sees the second poll", (ci) => ci.content?.msgContent?.text === text)
    await reaction(alice, state.groupIdAlice, state.multiItemAlice, "👍", true)
    await reaction(alice, state.groupIdAlice, state.multiItemAlice, "😂", true)
    await pollEdited(bob, "bob: two choices of one member", (t) => t === "What shall we read?\n\n👍 Part 1 · 1\n😀 Part 2 · 0\n😂 Part 3 · 1\n\nYou can choose several options with reactions.\n1 vote")
  })

  await step("the author deletes the poll post: the bot's message goes with it", async () => {
    await bob.expect(`/_delete item #${state.groupIdBob} ${state.pollCmdBob} broadcast`, ["chatItemsDeleted"])
    await alice.waitEvent("alice: the poll message deleted", (e) => e.type === "chatItemsDeleted" && (e.chatItemDeletions ?? []).some((d) => d.deletedChatItem?.chatItem?.meta?.itemId === state.pollItemAlice), 60_000)
    await waitFor("poll forgotten", () => !pollQuestions().includes("When shall we meet?"))
  })

  await step("the owner deletes the bot's poll message: the poll is forgotten", async () => {
    await alice.expect(`/_delete member item #${state.groupIdAlice} ${state.multiItemAlice}`, ["chatItemsDeleted"]) // moderation: the owner removes another member's message
    await waitFor("second poll forgotten", () => !pollQuestions().includes("What shall we read?"))
    if (pollQuestions().length !== 0) throw new Error(`polls left: ${pollQuestions()}`)
  })

  await step("the owner deletes the bot's file reply for everyone: the archived original stays", async () => {
    const reply = await alice.waitGroupItem("alice: the bot's report.pdf reply", (ci) => ci.file?.fileName === "report.pdf" && ci.quotedItem != null, {from: cfg.botName})
    await alice.expect(`/_delete member item #${state.groupIdAlice} ${reply.meta.itemId}`, ["chatItemsDeleted"])
    await sleep(3000) // the bot gets the deletion; the CLI drops the file of its own item
    if (!archiveNames().includes("report.pdf")) throw new Error(`report.pdf left the archive: ${archiveNames()}`)
    if (deletedNames().includes("report.pdf")) throw new Error("report.pdf was moved to the deleted folder")
  })

  await step("the archive holds exactly the kept files", async () => {
    const expected = ["captioned.pdf", "notes.txt", "report.pdf", state.cyrillicName].sort()
    if (archiveNames().join() !== expected.join()) throw new Error(`archive: ${archiveNames()}`)
    if (deletedNames().join() !== "comment.pdf") throw new Error(`deleted: ${deletedNames()}`)
  })

  for (const p of peers) p.close()
  log(`E2E: all ${passed} steps passed`)
  process.exit(0)
}

main().catch((e) => {
  log(`E2E: FAILED after ${passed} passing step(s): ${e.message}`)
  process.exit(1)
})
