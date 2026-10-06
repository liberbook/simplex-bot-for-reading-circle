import path from "node:path"

/** File statuses in which a received file offer can still be accepted. */
const ACCEPTABLE = new Set(["rcvInvitation", "rcvAborted"])

/**
 * Keeps every file posted in the served groups: asks the CLI to download it
 * into the archive (within the storage limit), moves the file of a deleted
 * post to the deleted folder and purges that folder after the retention time.
 * Says nothing while it works; the only word in the group is a refusal when
 * the archive is full.
 */
export class Keeper {
  /**
   * @param {object} deps
   * @param {import("../transport/SimplexClient.js").SimplexClient} deps.gateway
   * @param {import("../storage/Folder.js").Folder} deps.archive
   * @param {import("../storage/Folder.js").Folder} deps.deleted
   * @param {ReturnType<import("../i18n/ru.js").texts>} deps.texts
   * @param {import("../util/logger.js").Logger} deps.logger
   * @param {number} deps.maxBytes archive size limit
   * @param {number} deps.retentionMs how long deleted files are kept; 0 = forever
   */
  constructor({gateway, archive, deleted, texts, logger, maxBytes, retentionMs, clock = () => new Date()}) {
    this.gateway = gateway
    this.archive = archive
    this.deleted = deleted
    this.texts = texts
    this.logger = logger
    this.maxBytes = maxBytes
    this.retentionMs = retentionMs
    this.clock = clock
    this.downloading = new Map() // fileId -> size (reserved against the limit)
  }

  /**
   * A group message: if it carries a file offer, download it.
   * @param {import("../domain/Message.js").Message} message
   * @param {{quiet?: boolean}} [o] quiet - re-read history: keep files, but say nothing
   */
  async handle(message, {quiet = false} = {}) {
    const file = message.file
    if (!message.isGroup || !message.incoming || message.deleted || !file || !ACCEPTABLE.has(file.status) || this.downloading.has(file.id)) return
    if (!this.#fits(file.size)) {
      this.logger.warn(`refusing ${file.name} (${file.size} B): the archive is full`)
      if (!quiet) await this.gateway.sendText(message.chat, this.texts.archiveFull(), message.itemId)
      return
    }
    this.downloading.set(file.id, file.size)
    const result = await this.gateway.receiveFile(file.id)
    if (!result.ok) {
      this.downloading.delete(file.id)
      this.logger.warn(`cannot download ${file.name}: ${result.reason}`)
      return
    }
    this.logger.info(`downloading ${file.name} from #${message.chat.name}`)
  }

  onFileReceived(file) {
    if (!this.downloading.delete(file.id)) return
    this.logger.info(`kept ${path.basename(file.path ?? file.name)}`)
  }

  onFileFailed(file, reason) {
    if (!file || !this.downloading.delete(file.id)) return
    this.logger.warn(`download of ${file.name} failed: ${reason}`)
  }

  /**
   * A member's post was deleted for everyone: its file leaves the archive for the
   * deleted folder. The bot's own reply carrying a file is a copy of an archived
   * one - deleting that reply leaves the archive alone.
   */
  onMessageDeleted(message) {
    if (!message.isGroup || !message.incoming || !message.file) return
    const name = storedName(message.file)
    if (!this.archive.has(name)) return
    const storedAs = this.archive.moveTo(name, this.deleted, this.clock())
    this.logger.info(`post with ${name} deleted in #${message.chat.name} - moved to the deleted folder as ${storedAs}`)
    this.purge()
  }

  /** Removes deleted files older than the retention time. */
  purge() {
    if (this.retentionMs <= 0) return
    const removed = this.deleted.purgeOlderThan(this.retentionMs, this.clock().getTime())
    if (removed.length > 0) this.logger.info(`purged: ${removed.join(", ")}`)
  }

  /** Catch up on files posted while the bot was away - quietly. */
  async scan(groups, count) {
    if (count <= 0) return
    for (const group of groups) {
      try {
        for (const message of await this.gateway.recentMessages(group.id, count)) await this.handle(message, {quiet: true})
      } catch (e) {
        this.logger.warn(`scan of #${group.name} failed: ${e.message}`)
      }
    }
  }

  /**
   * Where a posted file is now.
   * @returns {{state: "kept", path: string} | {state: "downloading"} | {state: "missing"}}
   */
  locate(file) {
    const name = storedName(file)
    if (this.archive.has(name)) return {state: "kept", path: this.archive.pathOf(name)}
    if (this.downloading.has(file.id)) return {state: "downloading"}
    return {state: "missing"}
  }

  #fits(size) {
    const reserved = [...this.downloading.values()].reduce((a, b) => a + b, 0)
    if (this.archive.usedBytes() + reserved + size > this.maxBytes) return false
    const free = this.archive.freeDiskBytes()
    return free === null || free >= size
  }
}

/** The name the CLI gave the file in the files folder (it may differ from the offered name on a collision). */
export const storedName = (file) => path.basename(file.path ?? file.name)
