/**
 * Normalised incoming chat message - the only message shape the bot logic
 * ever sees. Built by the transport layer from raw CLI chat items.
 *
 * @typedef {{type: "direct"|"group", id: number, name: string, title?: string}} ChatRef
 *   name  - how this chat is called locally (unique in the bot's database)
 *   title - for groups: the group's own display name (as members see it)
 * @typedef {{contactId: number|null, name: string, memberId?: number}} Sender
 *   memberId - group member id, for group messages only (used for @mentions)
 * @typedef {{id: number, name: string, size: number, status: string, path: string|null, contentType: string}} FileOffer
 *   status - the CLI's file status ("rcvInvitation" = offered, "rcvComplete" = downloaded, ...)
 *   path   - the file's name in the files folder once the CLI knows it, else null
 *   contentType - "file" | "image" | "video" | "voice"
 */
export class Message {
  /**
   * @param {object} p
   * @param {ChatRef} p.chat where the message was posted
   * @param {Sender} p.sender who posted it
   * @param {boolean} p.incoming false for the bot's own messages
   * @param {number} p.itemId chat item id in the bot's database
   * @param {string} p.text message text or file caption
   * @param {FileOffer|null} [p.file] attached file, if any
   * @param {number|null} [p.quotedItemId] item this message replies to, if any (null also when the quoted
   *   post is one the bot never received - then `isReply` still says a quote exists)
   * @param {boolean} [p.isReply] the message quotes another one (defaults to `quotedItemId !== null`)
   * @param {boolean} [p.deleted] the post was deleted (for everyone or by a moderator); the CLI keeps such
   *   items in the chat, so re-read history still lists them
   * @param {Date|null} [p.sentAt] when the sender wrote it (informational)
   * @param {boolean} [p.forwarded] relayed to the bot by another member rather than received from the
   *   author: the group's history replayed when the bot joined, or a message from a member the bot is
   *   not directly connected to yet
   */
  constructor({chat, sender, incoming, itemId, text, file = null, quotedItemId = null, isReply = quotedItemId !== null, sentAt = null, forwarded = false, deleted = false}) {
    this.chat = chat
    this.sentAt = sentAt
    this.forwarded = forwarded
    this.deleted = deleted
    this.isReply = isReply
    this.sender = sender
    this.incoming = incoming
    this.itemId = itemId
    this.text = text ?? ""
    this.file = file
    this.quotedItemId = quotedItemId
    Object.freeze(this)
  }

  get isGroup() {
    return this.chat.type === "group"
  }

  get isDirect() {
    return this.chat.type === "direct"
  }

  get hasFile() {
    return this.file !== null
  }

  /**
   * Not a live request: group history replayed to the bot when it joined (such
   * items are forwarded by the admin who let it in). Deliberately clock-free -
   * comparing the sender's and the bot's clocks misfires when either is off.
   */
  get isReplayed() {
    return this.isGroup && this.forwarded
  }
}

/** File statuses in which a received file offer can still be accepted. */
const ACCEPTABLE_FILE_STATUSES = Object.freeze(["rcvInvitation", "rcvAborted"])

export function isAcceptable(file) {
  return ACCEPTABLE_FILE_STATUSES.includes(file.status)
}

/**
 * A file name the bot is willing to let the CLI write: a plain name, no path
 * separators, not hidden, no control characters. Sender-supplied names are
 * data from the network and the CLI joins them to the files folder.
 */
export function isSafeFileName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 255 && !/[/\\\p{Cc}]/u.test(name) && !name.startsWith(".")
}
