import {Kind, parseCommand} from "../domain/Command.js"

/**
 * The one text the bot explains itself with: answers "/?" in the group (as a
 * reply), any private message, and greets a group the bot joined.
 */
export class Helper {
  /**
   * @param {object} deps
   * @param {import("../transport/SimplexClient.js").SimplexClient} deps.gateway
   * @param {ReturnType<import("../i18n/ru.js").texts>} deps.texts
   * @param {import("../util/logger.js").Logger} deps.logger
   * @param {string} deps.trigger for the command parser
   */
  constructor({gateway, texts, logger, trigger}) {
    this.gateway = gateway
    this.texts = texts
    this.logger = logger
    this.trigger = trigger
  }

  /** @param {import("../domain/Message.js").Message} message @returns {Promise<boolean>} handled */
  async handle(message) {
    if (!message.incoming) return false
    if (message.isDirect) {
      this.logger.info(`${message.sender.name} writes privately - answered with the help`)
      await this.gateway.sendText(message.chat, this.texts.help())
      return true
    }
    if (parseCommand(message.text, this.trigger).kind !== Kind.HELP) return false
    await this.gateway.sendText(message.chat, this.texts.help(), message.itemId)
    return true
  }

  /** The bot joined a group: say what it does. */
  async greet(group) {
    await this.gateway.sendText(group, this.texts.help())
  }
}
