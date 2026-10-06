import fs from "node:fs"
import path from "node:path"

/** Polls, persisted as one JSON file: {nextId, polls: {"12": Poll}}. Pure data access. */
export class PollStore {
  constructor(filePath) {
    this.filePath = filePath
  }

  /** Stores a new poll under the next free number. @returns the stored poll (with id) */
  add(poll) {
    const data = this.#read()
    const stored = {...poll, id: data.nextId}
    data.polls[stored.id] = stored
    data.nextId++
    this.#write(data)
    return stored
  }

  save(poll) {
    const data = this.#read()
    data.polls[poll.id] = poll
    this.#write(data)
    return poll
  }

  remove(id) {
    const data = this.#read()
    delete data.polls[id]
    this.#write(data)
  }

  get(id) {
    return this.#read().polls[id] ?? null
  }

  /** All polls, oldest first. */
  list() {
    return Object.values(this.#read().polls).sort((a, b) => a.id - b.id)
  }

  find(predicate) {
    return this.list().find(predicate) ?? null
  }

  #read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"))
      return {nextId: data.nextId ?? 1, polls: data.polls ?? {}}
    } catch {
      return {nextId: 1, polls: {}}
    }
  }

  #write(data) {
    fs.mkdirSync(path.dirname(this.filePath), {recursive: true})
    const tmp = `${this.filePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n")
    fs.renameSync(tmp, this.filePath)
  }
}
