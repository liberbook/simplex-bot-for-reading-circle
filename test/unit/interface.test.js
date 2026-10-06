import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {generate} from "../../scripts/interface-doc.js"

const ROOT = path.resolve(import.meta.dirname, "..", "..")

test("INTERFACE.md is what scripts/interface-doc.js produces from the current code (regenerate with `npm run doc`)", async () => {
  const committed = fs.readFileSync(path.join(ROOT, "INTERFACE.md"), "utf8")
  assert.equal(committed, await generate())
})

test("README names the documents and the test commands", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8")
  for (const needle of ["INTERFACE.md", "npm test", "npm run test:e2e"]) assert.match(readme, new RegExp(needle.replace(/[.:]/g, "\\$&")), `README should mention ${needle}`)
})
