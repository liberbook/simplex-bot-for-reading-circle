import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {Keeper} from "../../src/bot/Keeper.js"
import {Folder} from "../../src/storage/Folder.js"
import {FakeGateway, GROUP, groupMessage, offer, silentLogger, texts} from "./helpers.js"

function setup({maxBytes = 10 * 1024, retentionMs = 30 * 86_400_000, recent = []} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conatus-"))
  const archive = new Folder(path.join(root, "files"))
  const deleted = new Folder(path.join(root, "deleted"))
  archive.ensure()
  let now = new Date("2026-09-12T10:00:00Z")
  const gateway = new FakeGateway({recent})
  const keeper = new Keeper({gateway, archive, deleted, texts, logger: silentLogger, maxBytes, retentionMs, clock: () => now})
  /** the CLI finished a download: the file appears in the folder */
  const finish = (file, name = file.name) => {
    fs.writeFileSync(path.join(archive.dir, name), "x".repeat(file.size))
    keeper.onFileReceived({...file, path: name})
  }
  return {gateway, keeper, archive, deleted, finish, advance: (ms) => (now = new Date(now.getTime() + ms))}
}

test("every file posted in the group is downloaded once, silently; other chats and own posts are not", async () => {
  const {gateway, keeper, finish} = setup()
  await keeper.handle(groupMessage({text: "whatever caption", file: offer()}))
  await keeper.handle(groupMessage({text: "", file: offer()})) // the same offer again while downloading
  await keeper.handle(groupMessage({file: offer({id: 8}), incoming: false}))
  await keeper.handle(groupMessage({file: offer({id: 9}), chat: {type: "direct", id: 3, name: "alice"}}))
  await keeper.handle(groupMessage({file: offer({id: 10, status: "rcvComplete"})})) // already downloaded earlier
  await keeper.handle(groupMessage({text: "no file"}))
  assert.deepEqual(gateway.received, [7])
  assert.deepEqual(gateway.sent, [], "nothing to say")
  assert.deepEqual(keeper.locate(offer()), {state: "downloading"})
  finish(offer())
  assert.equal(keeper.locate(offer({path: "report.pdf"})).state, "kept")
  assert.equal(keeper.locate(offer({id: 99, name: "other.pdf"})).state, "missing")
})

test("the storage limit: a file that does not fit is refused with one line; re-read history is refused silently", async () => {
  const {gateway, keeper, finish} = setup({maxBytes: 3000})
  await keeper.handle(groupMessage({itemId: 11, file: offer({id: 1, name: "a.pdf", size: 2000})}))
  await keeper.handle(groupMessage({itemId: 12, file: offer({id: 2, name: "b.pdf", size: 2000})})) // 2000 reserved + 2000 > 3000
  assert.deepEqual(gateway.received, [1])
  assert.deepEqual(gateway.sent, [{chat: GROUP, text: "File not kept: the archive is full.", quotedItemId: 12}])
  finish(offer({id: 1, name: "a.pdf", size: 2000}))
  await keeper.handle(groupMessage({itemId: 13, file: offer({id: 3, name: "c.pdf", size: 500})}))
  assert.deepEqual(gateway.received, [1, 3], "a small file still fits")
  await keeper.handle(groupMessage({itemId: 14, file: offer({id: 4, name: "d.pdf", size: 2000})}), {quiet: true})
  assert.equal(gateway.sent.length, 1, "quiet: no refusal notice for history")
})

test("a failed download frees its reservation; a refused offer is not remembered as downloading", async () => {
  const {gateway, keeper} = setup()
  gateway.receiveResult = {ok: false, reason: "sender cancelled"}
  await keeper.handle(groupMessage({file: offer()}))
  assert.equal(keeper.locate(offer()).state, "missing")
  gateway.receiveResult = {ok: true}
  await keeper.handle(groupMessage({file: offer()}))
  keeper.onFileFailed(offer(), "timeout")
  assert.equal(keeper.locate(offer()).state, "missing")
  keeper.onFileFailed(null, "nothing") // tolerated
})

test("a post deleted for everyone takes its file to the deleted folder, where it is purged after the retention time", async () => {
  const {gateway, keeper, archive, deleted, finish, advance} = setup()
  await keeper.handle(groupMessage({file: offer()}))
  finish(offer(), "report_1.pdf") // the CLI renamed it on a name clash
  keeper.onMessageDeleted(groupMessage({file: offer({status: "rcvComplete", path: "report_1.pdf"})}))
  assert.deepEqual(archive.list(), [])
  assert.deepEqual(deleted.list().map((f) => f.name), ["report_1.pdf"])
  keeper.onMessageDeleted(groupMessage({file: offer({name: "unknown.pdf", path: "unknown.pdf"})})) // nothing to move
  keeper.onMessageDeleted(groupMessage({text: "just text"}))
  advance(31 * 86_400_000)
  keeper.purge()
  assert.deepEqual(deleted.list(), [], "gone after 30 days")
  assert.deepEqual(gateway.sent, [])
})

test("scan re-reads the group's recent messages and downloads what was missed, quietly", async () => {
  const recent = [
    groupMessage({itemId: 1, file: offer({id: 1, name: "old.pdf", status: "rcvComplete", path: "old.pdf"})}),
    groupMessage({itemId: 2, file: offer({id: 2, name: "missed.pdf"})}),
    groupMessage({itemId: 3, text: "conatus"}),
    groupMessage({itemId: 4, file: offer({id: 4, name: "gone.pdf"}), deleted: true}), // the post was deleted: not worth keeping
  ]
  const {gateway, keeper} = setup({recent})
  await keeper.scan([GROUP], 20)
  assert.deepEqual(gateway.received, [2])
  await keeper.scan([GROUP], 0)
  assert.deepEqual(gateway.received, [2], "scan 0 = off")
})

test("the bot's own reply carrying a file is deleted for everyone: the archived original stays", async () => {
  const {keeper, archive, deleted, finish} = setup()
  await keeper.handle(groupMessage({file: offer()}))
  finish(offer())
  keeper.onMessageDeleted(groupMessage({incoming: false, file: offer({status: "sndComplete", path: "/files/.outbox/1-ab/report.pdf"})}))
  assert.deepEqual(archive.list().map((f) => f.name), ["report.pdf"])
  assert.deepEqual(deleted.list(), [])
})
