import {sendThrough} from "../storage/Outbox.js"
import {Kind, parseCommand} from "../domain/Command.js"

/**
 * Hands files back: the trigger word written as a reply to a post (or as a
 * bare comment right after one - the apps' comments reach the CLI without a
 * parent link) makes the bot answer with that post's file.
 */
export class Courier {
  /**
   * @param {object} deps
   * @param {import("../transport/SimplexClient.js").SimplexClient} deps.gateway
   * @param {import("./Keeper.js").Keeper} deps.keeper knows where a file is
   * @param {import("../storage/Outbox.js").Outbox} [deps.outbox] files go out as copies, so the CLI never deletes an archived original
   * @param {ReturnType<import("../i18n/ru.js").texts>} deps.texts
   * @param {import("../util/logger.js").Logger} deps.logger
   * @param {string} deps.trigger the word
   * @param {number} [deps.lookback] how many recent messages a bare comment may refer to
   */
  constructor({gateway, keeper, outbox = null, texts, logger, trigger, lookback = 20}) {
    this.outbox = outbox
    this.gateway = gateway
    this.keeper = keeper
    this.texts = texts
    this.logger = logger
    this.trigger = trigger
    this.lookback = lookback
  }

  /** @param {import("../domain/Message.js").Message} message @returns {Promise<boolean>} handled */
  async handle(message) {
    if (!message.isGroup || !message.incoming || message.hasFile || parseCommand(message.text, this.trigger).kind !== Kind.FETCH) return false
    const reply = (text) => this.gateway.sendText(message.chat, text, message.itemId)
    if (message.isReply && message.quotedItemId === null) {
      // a reply to a post the bot never received (older than the history it got): guessing would hand out the wrong file
      await reply(this.texts.unknownPost())
      return true
    }
    const post = await this.#post(message)
    if (!post) {
      await reply(this.texts.whichFile())
      return true
    }
    if (!post.hasFile) {
      await reply(this.texts.noFileInPost())
      return true
    }
    const where = this.keeper.locate(post.file)
    this.logger.info(`${message.sender.name} asks for ${post.file.name}: ${where.state}`)
    if (where.state === "kept") await sendThrough(this.outbox, where.path, (copy) => this.gateway.sendFile(message.chat, copy, message.itemId))
    else if (where.state === "downloading") await reply(this.texts.stillDownloading(post.file.name))
    else await reply(this.texts.notKept(post.file.name))
    return true
  }

  /** The post the request refers to: the quoted one, else the latest file posted before it (deleted posts are no longer "there" for anyone). */
  async #post(message) {
    if (message.quotedItemId !== null) return this.gateway.messageById(message.chat.id, message.quotedItemId)
    const recent = await this.gateway.recentMessages(message.chat.id, this.lookback)
    return recent.filter((m) => m.hasFile && m.incoming && !m.deleted && m.itemId < message.itemId).at(-1) ?? null
  }
}
