import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {Courier} from "../../src/bot/Courier.js"
import {Keeper} from "../../src/bot/Keeper.js"
import {Folder} from "../../src/storage/Folder.js"
import {Outbox} from "../../src/storage/Outbox.js"
import {BOB, FakeGateway, GROUP, groupMessage, offer, silentLogger, texts} from "./helpers.js"

function setup({recent = [], items = {}} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conatus-"))
  const archive = new Folder(path.join(root, "files"))
  archive.ensure()
  const gateway = new FakeGateway({recent, items})
  const keeper = new Keeper({gateway, archive, deleted: new Folder(path.join(root, "deleted")), texts, logger: silentLogger, maxBytes: 1e9, retentionMs: 0})
  const courier = new Courier({gateway, keeper, texts, logger: silentLogger, trigger: "conatus"})
  const kept = (name) => fs.writeFileSync(path.join(archive.dir, name), "bytes")
  return {gateway, keeper, courier, kept, archive}
}

test("the trigger word as a reply to a post with a file: the file comes back as a reply to the request", async () => {
  const post = groupMessage({itemId: 30, sender: BOB, file: offer({status: "rcvComplete", path: "report.pdf"})})
  const {gateway, courier, kept, archive} = setup({items: {"1:30": post}})
  kept("report.pdf")
  assert.equal(await courier.handle(groupMessage({itemId: 31, text: "conatus", quotedItemId: 30})), true)
  assert.deepEqual(gateway.sent, [{chat: GROUP, filePath: path.join(archive.dir, "report.pdf"), quotedItemId: 31}])
})

test("a bare comment (no reply link) refers to the latest file posted before it", async () => {
  const recent = [
    groupMessage({itemId: 30, file: offer({id: 1, name: "first.pdf", status: "rcvComplete", path: "first.pdf"})}),
    groupMessage({itemId: 32, file: offer({id: 2, name: "second.pdf", status: "rcvComplete", path: "second.pdf"})}),
    groupMessage({itemId: 33, file: offer({id: 3, name: "mine.pdf", status: "sndComplete", path: "mine.pdf"}), incoming: false}),
    groupMessage({itemId: 40, file: offer({id: 4, name: "later.pdf", status: "rcvComplete", path: "later.pdf"})}),
  ]
  const {gateway, courier, kept} = setup({recent})
  kept("second.pdf")
  await courier.handle(groupMessage({itemId: 35, text: "Conatus!"}))
  assert.match(gateway.sent[0].filePath, /second\.pdf$/, "the bot's own file and later files are not candidates")
  assert.equal(gateway.sent[0].quotedItemId, 35)
})

test("a bare comment skips posts that were deleted: their file is gone for everyone, so it is not what was meant", async () => {
  const recent = [
    groupMessage({itemId: 30, file: offer({id: 1, name: "first.pdf", status: "rcvComplete", path: "first.pdf"})}),
    groupMessage({itemId: 32, file: offer({id: 2, name: "removed.pdf", status: "rcvComplete", path: "removed.pdf"}), deleted: true}),
  ]
  const {gateway, courier, kept} = setup({recent})
  kept("first.pdf")
  await courier.handle(groupMessage({itemId: 35, text: "conatus"}))
  assert.match(gateway.sent[0].filePath, /first\.pdf$/, "not «removed.pdf was not kept»")
})

test("a reply to a post the bot never received (quote without an item id) is answered honestly, never by guessing", async () => {
  const recent = [groupMessage({itemId: 32, file: offer({id: 2, name: "latest.pdf", status: "rcvComplete", path: "latest.pdf"})})]
  const {gateway, courier, kept} = setup({recent})
  kept("latest.pdf")
  await courier.handle(groupMessage({itemId: 35, text: "conatus", quotedItemId: null, isReply: true}))
  assert.deepEqual(gateway.sent, [{chat: GROUP, text: "That post is older than the history I have - I do not have its file.", quotedItemId: 35}])
})

test("what the bot says when it cannot hand the file over", async () => {
  const items = {
    "1:30": groupMessage({itemId: 30, text: "just text"}),
    "1:31": groupMessage({itemId: 31, file: offer({id: 5, name: "big.pdf"})}),
    "1:32": groupMessage({itemId: 32, file: offer({id: 6, name: "lost.pdf", status: "rcvComplete", path: "lost.pdf"})}),
  }
  const {gateway, courier, keeper} = setup({items})
  await courier.handle(groupMessage({itemId: 50, text: "conatus", quotedItemId: 30}))
  await courier.handle(groupMessage({itemId: 51, text: "conatus", quotedItemId: 99})) // the quoted item is unknown
  await keeper.handle(groupMessage({itemId: 31, file: offer({id: 5, name: "big.pdf"})})) // still downloading
  await courier.handle(groupMessage({itemId: 52, text: "conatus", quotedItemId: 31}))
  await courier.handle(groupMessage({itemId: 53, text: "conatus", quotedItemId: 32})) // downloaded once, but gone from the folder
  await courier.handle(groupMessage({itemId: 54, text: "conatus"})) // no file anywhere near
  assert.deepEqual(
    gateway.sent.map((m) => [m.quotedItemId, m.text]),
    [
      [50, "There is no file in that post."],
      [51, "Which file? Reply conatus to the post with the file."],
      [52, "big.pdf is still downloading - try again in a minute."],
      [53, "lost.pdf was not kept: the download failed or the file is already gone."],
      [54, "Which file? Reply conatus to the post with the file."],
    ]
  )
})

test("talk that merely contains the word, files, private chats and own messages are not requests", async () => {
  const {gateway, courier} = setup()
  assert.equal(await courier.handle(groupMessage({text: "Спиноза писал о conatus как о стремлении"})), false)
  assert.equal(await courier.handle(groupMessage({text: "conatus", file: offer()})), false)
  assert.equal(await courier.handle(groupMessage({text: "conatus", incoming: false})), false)
  assert.deepEqual(gateway.sent, [])
})

test("with an outbox the CLI gets a copy, so deleting the bot's reply can never delete the archived original", async () => {
  const post = groupMessage({itemId: 30, sender: BOB, file: offer({status: "rcvComplete", path: "report.pdf"})})
  const {gateway, keeper, kept, archive} = setup({items: {"1:30": post}})
  kept("report.pdf")
  const outbox = new Outbox(path.join(archive.dir, ".outbox"))
  outbox.ensure()
  const courier = new Courier({gateway, keeper, outbox, texts, logger: silentLogger, trigger: "conatus"})
  await courier.handle(groupMessage({itemId: 31, text: "conatus", quotedItemId: 30}))
  const sent = gateway.sent[0].filePath
  assert.equal(path.basename(sent), "report.pdf")
  assert.equal(path.dirname(path.dirname(sent)), outbox.dir)
  fs.unlinkSync(sent) // what the CLI does when the reply is deleted
  assert.deepEqual(archive.list().map((f) => f.name), ["report.pdf"], "the outbox folder is not a file of the archive")
  outbox.release(sent)
  assert.deepEqual(fs.readdirSync(outbox.dir), [])
})
