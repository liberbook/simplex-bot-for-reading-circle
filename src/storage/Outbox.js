import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

/**
 * Files the bot sends are handed to the CLI as copies kept here, never as the
 * archive files themselves: the CLI deletes the file of a chat item whenever
 * that item goes (a deleted contact, a deleted chat, a deleted message), and it
 * must not take the archived original with it. A copy is a hard link when the
 * folders share a filesystem (no extra space), a real copy otherwise; each lives
 * in its own subfolder so the recipient sees the original name. A copy is
 * released once the upload finished; leftovers are purged by age.
 */
export class Outbox {
  constructor(dir) {
    this.dir = path.resolve(dir)
  }

  ensure() {
    fs.mkdirSync(this.dir, {recursive: true})
  }

  /** @returns {Promise<string>} the path of a fresh copy of `source`, with the same file name */
  async copyOf(source) {
    const folder = path.join(this.dir, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`)
    await fsp.mkdir(folder, {recursive: true})
    const copy = path.join(folder, path.basename(source))
    try {
      await fsp.link(source, copy)
    } catch {
      await fsp.copyFile(source, copy) // another filesystem, or links not allowed
    }
    return copy
  }

  /** Hands `send` a copy of `source`; the copy goes again if sending fails (no upload will release it). */
  async send(source, send) {
    const copy = await this.copyOf(source)
    try {
      return await send(copy)
    } catch (e) {
      this.release(copy)
      throw e
    }
  }

  /** The upload of a copy finished: remove it. Paths outside the outbox are left alone. */
  release(filePath) {
    if (!filePath) return
    const folder = path.dirname(path.resolve(filePath))
    if (path.dirname(folder) !== this.dir) return
    fs.rmSync(folder, {recursive: true, force: true})
  }

  /** Removes copies older than `maxAgeMs` (uploads that never finished). @returns {number} how many */
  purgeOlderThan(maxAgeMs, now = Date.now()) {
    let removed = 0
    let entries
    try {
      entries = fs.readdirSync(this.dir, {withFileTypes: true})
    } catch {
      return 0 // removed by hand: copyOf() creates it again
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const folder = path.join(this.dir, entry.name)
      if (now - fs.statSync(folder).mtimeMs < maxAgeMs) continue
      fs.rmSync(folder, {recursive: true, force: true})
      removed++
    }
    return removed
  }
}

/** Sends a stored file through the outbox when there is one (tests may run without). */
export const sendThrough = (outbox, source, send) => (outbox ? outbox.send(source, send) : send(source))
