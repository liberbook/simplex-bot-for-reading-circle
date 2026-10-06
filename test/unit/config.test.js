import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {parseConfig} from "../../src/config.js"
import {Folder} from "../../src/storage/Folder.js"

test("defaults < file < environment < flags", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "conatus-")), "conatus.json")
  fs.writeFileSync(file, JSON.stringify({group: "Ethics", scan: 5, groupLinks: ["https://a"]}))
  const c = parseConfig(["--config", file, "--trigger", "Save"], {CONATUS_SCAN: "7", CONATUS_MAX_STORAGE: "1gb", HOME: "/home/tester"})
  assert.equal(c.group, "Ethics")
  assert.equal(c.scan, 7)
  assert.equal(c.trigger, "Save")
  assert.equal(c.maxStorageBytes, 1024 ** 3)
  assert.deepEqual(c.groupLinks, ["https://a"])
  assert.equal(c.deletedRetentionDays, 30)
  assert.equal(parseConfig(["-h"]).help, true)
  assert.throws(() => parseConfig([], {CONATUS_TRIGGER: "two words"}), /one word/)
  assert.throws(() => parseConfig(["--dir", "x", "--deleted-dir", "x"]), /differ/)
  fs.writeFileSync(file, JSON.stringify({nonsense: 1}))
  assert.throws(() => parseConfig(["--config", file]), /unknown setting "nonsense"/)
})

test("Folder: list, move with a timestamp on a clash, purge by age", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conatus-"))
  const a = new Folder(path.join(root, "a"))
  const b = new Folder(path.join(root, "b"))
  a.ensure()
  fs.writeFileSync(path.join(a.dir, "x.pdf"), "12345")
  fs.mkdirSync(path.join(a.dir, "sub"))
  assert.deepEqual(a.list().map((f) => [f.name, f.size]), [["x.pdf", 5]], "subfolders are not files")
  assert.equal(a.usedBytes(), 5)
  const now = new Date("2026-09-12T10:00:00Z")
  assert.equal(a.moveTo("x.pdf", b, now), "x.pdf")
  fs.writeFileSync(path.join(a.dir, "x.pdf"), "1")
  assert.equal(a.moveTo("x.pdf", b, now), "x.20260912-100000.pdf", "a clash gets a timestamp")
  assert.throws(() => a.pathOf("x.pdf"), /not a stored file/)
  assert.throws(() => a.pathOf("../b/x.pdf"))
  assert.deepEqual(b.purgeOlderThan(86_400_000, now.getTime() + 2 * 86_400_000).sort(), ["x.20260912-100000.pdf", "x.pdf"])
  assert.deepEqual(b.list(), [])
})
