import fs from "node:fs"
import path from "node:path"

/**
 * A flat folder of files (the archive, or the deleted folder). The directory
 * listing is the source of truth: files the CLI saved are all there. Names
 * come from readdir and are only ever joined to this folder, so a request can
 * never reach outside it.
 */
export class Folder {
  constructor(dir) {
    this.dir = path.resolve(dir)
  }

  ensure() {
    fs.mkdirSync(this.dir, {recursive: true})
  }

  /** @returns {Array<{name: string, size: number, modifiedAt: Date}>} */
  list() {
    let entries
    try {
      entries = fs.readdirSync(this.dir, {withFileTypes: true})
    } catch {
      return []
    }
    return entries
      .filter((e) => e.isFile())
      .map((e) => {
        try {
          const st = fs.statSync(path.join(this.dir, e.name))
          return {name: e.name, size: st.size, modifiedAt: st.mtime}
        } catch {
          return null
        }
      })
      .filter(Boolean)
  }

  has(name) {
    return this.list().some((f) => f.name === name)
  }

  /** Absolute path of a stored file; throws for unknown names. */
  pathOf(name) {
    if (!this.has(name)) throw new Error(`not a stored file: ${name}`)
    return path.join(this.dir, name)
  }

  /**
   * Moves a file into another folder; a name already taken there gets a
   * timestamp. The moved file's modification time becomes `now`, so retention
   * in the target counts from the move. @returns {string} the name there
   */
  moveTo(name, target, now = new Date()) {
    const source = this.pathOf(name)
    target.ensure()
    let base = name
    for (let n = 0; fs.existsSync(path.join(target.dir, base)); n++) base = stamped(name, now, n)
    const destination = path.join(target.dir, base)
    try {
      fs.renameSync(source, destination)
    } catch (e) {
      if (e.code !== "EXDEV") throw e
      fs.copyFileSync(source, destination)
      fs.unlinkSync(source)
    }
    fs.utimesSync(destination, now, now)
    return base
  }

  /** Removes files not modified for `maxAgeMs`. @returns {string[]} the removed names */
  purgeOlderThan(maxAgeMs, now = Date.now()) {
    const removed = []
    for (const f of this.list()) {
      if (now - f.modifiedAt.getTime() <= maxAgeMs) continue
      try {
        fs.unlinkSync(path.join(this.dir, f.name))
        removed.push(f.name)
      } catch {
        /* disappeared meanwhile */
      }
    }
    return removed
  }

  usedBytes() {
    return this.list().reduce((sum, f) => sum + f.size, 0)
  }

  /** Free space on the filesystem holding the folder, or null if unknown. */
  freeDiskBytes() {
    try {
      const st = fs.statfsSync(this.dir)
      return Number(st.bavail) * Number(st.bsize)
    } catch {
      return null
    }
  }
}

/** "report.pdf" + 2026-09-07T18:12:03Z -> "report.20260907-181203.pdf" (n > 0 appends "-n") */
function stamped(name, date, n) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)
  const ext = path.extname(name)
  return `${ext ? name.slice(0, -ext.length) : name}.${stamp}${n > 0 ? `-${n}` : ""}${ext}`
}
