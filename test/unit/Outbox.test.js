import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {Outbox} from "../../src/storage/Outbox.js"

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "filebot-outbox-"))

test("a copy keeps the file name; removing it (as the CLI does with a deleted chat) leaves the original", async () => {
  const root = tmp()
  const original = path.join(root, "report.pdf")
  fs.writeFileSync(original, "content")
  const outbox = new Outbox(path.join(root, "outbox"))
  outbox.ensure()
  const copy = await outbox.copyOf(original)
  assert.equal(path.basename(copy), "report.pdf")
  assert.notEqual(copy, original)
  assert.equal(fs.readFileSync(copy, "utf8"), "content")
  fs.unlinkSync(copy)
  assert.equal(fs.readFileSync(original, "utf8"), "content")
  assert.notEqual(path.dirname(await outbox.copyOf(original)), path.dirname(await outbox.copyOf(original)), "every copy in its own folder")
})

test("release removes a finished copy, never a path outside the outbox; old leftovers are purged", async () => {
  const root = tmp()
  const original = path.join(root, "a.pdf")
  fs.writeFileSync(original, "x")
  const outbox = new Outbox(path.join(root, "outbox"))
  outbox.ensure()
  const copy = await outbox.copyOf(original)
  outbox.release(copy)
  assert.equal(fs.existsSync(path.dirname(copy)), false)
  outbox.release(original)
  outbox.release(null)
  assert.equal(fs.existsSync(original), true)
  await outbox.copyOf(original)
  assert.equal(outbox.purgeOlderThan(60_000), 0)
  assert.equal(outbox.purgeOlderThan(60_000, Date.now() + 120_000), 1)
  assert.deepEqual(fs.readdirSync(outbox.dir), [])
})

test("a failed send takes its copy away; a missing outbox folder is no error", async () => {
  const root = tmp()
  const original = path.join(root, "a.pdf")
  fs.writeFileSync(original, "x")
  const outbox = new Outbox(path.join(root, "outbox"))
  outbox.ensure()
  let handed = null
  await assert.rejects(outbox.send(original, async (copy) => {
    handed = copy
    throw new Error("network")
  }))
  assert.equal(fs.existsSync(handed), false)
  assert.equal(await outbox.send(original, async (copy) => path.basename(copy)), "a.pdf")
  fs.rmSync(outbox.dir, {recursive: true})
  assert.equal(outbox.purgeOlderThan(0), 0)
})
