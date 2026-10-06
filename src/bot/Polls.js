import {Kind, parseCommand} from "../domain/Command.js"
import {POLL_REACTIONS, castBallot, newPoll, optionOfReaction, parsePoll, rebuildBallots, tally} from "../domain/Poll.js"

/**
 * Polls in the group: "/голосование Вопрос? | а | б" makes the bot answer with
 * one message members react to; the message is edited as votes come (a burst
 * of reactions becomes one edit) and lives until the member deletes their post
 * or a moderator deletes the bot's message. After a restart the ballots are
 * rebuilt from the reactions the CLI knows. Timers are injectable.
 */
export class Polls {
  /**
   * @param {object} deps
   * @param {import("../transport/SimplexClient.js").SimplexClient} deps.gateway
   * @param {import("../storage/PollStore.js").PollStore} deps.store
   * @param {ReturnType<import("../i18n/ru.js").texts>} deps.texts
   * @param {import("../util/logger.js").Logger} deps.logger
   * @param {string} deps.trigger for the command parser
   */
  constructor({gateway, store, texts, logger, trigger, clock = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout, editDelayMs = 2_000}) {
    this.gateway = gateway
    this.store = store
    this.texts = texts
    this.logger = logger
    this.trigger = trigger
    this.clock = clock
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.editDelayMs = editDelayMs
    this.editTimers = new Map() // poll id -> timer
  }

  /** After (re)connecting: catch up on the reactions the bot missed. */
  async start() {
    this.stop()
    for (const poll of this.store.list()) {
      try {
        await this.#resync(poll)
      } catch (e) {
        this.logger.warn(`poll ${poll.id}: cannot re-read reactions: ${e.message}`)
      }
    }
  }

  stop() {
    for (const t of this.editTimers.values()) this.clearTimer(t)
    this.editTimers.clear()
  }

  /** @param {import("../domain/Message.js").Message} message @returns {Promise<boolean>} handled */
  async handle(message) {
    if (!message.isGroup || !message.incoming) return false
    const command = parseCommand(message.text, this.trigger)
    if (command.kind !== Kind.POLL) return false
    const parsed = parsePoll(command.argument)
    if (!parsed.ok) {
      await this.gateway.sendText(message.chat, this.texts.pollError(parsed.error), message.itemId)
      return true
    }
    const poll = this.store.add(newPoll({...parsed, author: message.sender.name, group: message.chat, commandItemId: message.itemId, now: this.clock()}))
    poll.itemId = await this.gateway.sendText(message.chat, this.render(poll), message.itemId)
    this.store.save(poll)
    this.logger.info(`poll ${poll.id} "${poll.question}" opened in #${message.chat.name} by ${message.sender.name}`)
    return true
  }

  /** A reaction on some message: a vote if the message is a poll. */
  async onReaction({chat, itemId, sender, emoji, added}) {
    if (chat.type !== "group") return
    const poll = this.store.find((p) => p.group.id === chat.id && p.itemId === itemId)
    if (!poll) return
    const option = optionOfReaction(emoji)
    if (option < 0 || !castBallot(poll, memberKey(sender), sender.name, option, added, this.clock())) return
    this.store.save(poll)
    this.logger.info(`poll ${poll.id}: ${sender.name} ${added ? "chose" : "withdrew"} option ${option + 1}`)
    this.#scheduleEdit(poll.id)
  }

  /** The member's post or the bot's message was deleted: the poll is over and its message goes. */
  async onMessageDeleted(message) {
    if (!message.isGroup) return
    const poll = this.store.find((p) => p.group.id === message.chat.id && (p.itemId === message.itemId || p.commandItemId === message.itemId))
    if (!poll) return
    const timer = this.editTimers.get(poll.id)
    if (timer) this.clearTimer(timer)
    this.editTimers.delete(poll.id)
    this.store.remove(poll.id)
    this.logger.info(`poll ${poll.id} "${poll.question}" removed with its post`)
    if (message.itemId === poll.commandItemId && poll.itemId !== null) {
      try {
        await this.gateway.deleteMessage(message.chat, poll.itemId)
      } catch (e) {
        this.logger.warn(`poll ${poll.id}: cannot delete the message: ${e.message}`)
      }
    }
  }

  render(poll) {
    return this.texts.poll(poll, tally(poll))
  }

  #scheduleEdit(id) {
    const pending = this.editTimers.get(id)
    if (pending) this.clearTimer(pending)
    this.editTimers.set(
      id,
      this.setTimer(() => {
        this.editTimers.delete(id)
        const poll = this.store.get(id)
        if (poll) this.#edit(poll).catch((e) => this.logger.warn(`poll ${id}: ${e.message}`))
      }, this.editDelayMs)
    )
  }

  async #edit(poll) {
    if (poll.itemId === null) return
    await this.gateway.editText({type: "group", id: poll.group.id, name: poll.group.name}, poll.itemId, this.render(poll))
  }

  async #resync(poll) {
    if (poll.itemId === null) return
    const reactions = []
    for (const [option] of poll.options.entries()) {
      const members = await this.gateway.reactionMembers(poll.group.id, poll.itemId, POLL_REACTIONS[option])
      reactions.push({option, members: members.map((m) => ({key: memberKey(m), name: m.name, at: m.at}))})
    }
    const before = JSON.stringify(poll.ballots)
    rebuildBallots(poll, reactions)
    if (JSON.stringify(poll.ballots) === before) return
    this.store.save(poll)
    this.logger.info(`poll ${poll.id}: ballots rebuilt from the reactions`)
    await this.#edit(poll)
  }
}

const memberKey = (who) => String(who.memberId ?? who.contactId ?? who.name)
