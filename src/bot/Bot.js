import fs from "node:fs"
import path from "node:path"
import {groupMatches} from "../domain/Command.js"

/** Copies in the outbox whose upload never finished are dropped after this long. */
const OUTBOX_MAX_AGE_MS = 24 * 3_600_000

const SETUP_RETRY_MS = 5_000
const MAX_BACKLOG = 1000

/**
 * Orchestrator: connects the gateway, configures the profile, joins the
 * configured groups and routes events to the Keeper (files), the Courier
 * (hand-outs), the Polls and the Helper. No chat logic of its own.
 */
export class Bot {
  /**
   * @param {object} deps
   * @param {import("../transport/SimplexClient.js").SimplexClient} deps.gateway
   * @param {import("./Keeper.js").Keeper} deps.keeper
   * @param {import("./Courier.js").Courier} deps.courier
   * @param {import("./Polls.js").Polls} deps.polls
   * @param {import("./Helper.js").Helper} deps.helper
   * @param {import("../util/logger.js").Logger} deps.logger
   * @param {{filesDir: string, stateDir: string, group: string, groupLinks: string[], scan: number, botCommands: string}} deps.options
   */
  constructor({gateway, keeper, courier, polls, helper, outbox = null, logger, options}) {
    this.outbox = outbox // copies of the files being sent: released after the upload
    this.gateway = gateway
    this.keeper = keeper
    this.courier = courier
    this.polls = polls
    this.helper = helper
    this.logger = logger
    this.options = options
    this.ready = false
    this.backlog = []
    this.connectionNo = 0
  }

  /** Resolves once connected; keeps running until stop(). */
  async run() {
    this.gateway.onEvent((event) => this.#dispatch(event))
    this.gateway.onOpen(() => this.#setupWithRetry(++this.connectionNo))
    await this.gateway.start()
  }

  stop() {
    this.polls.stop()
    this.gateway.stop()
  }

  async #setupWithRetry(connectionNo) {
    for (;;) {
      try {
        await this.#setup()
        return
      } catch (e) {
        this.logger.error(`setup failed: ${e.message} - retrying in ${SETUP_RETRY_MS / 1000}s`)
        await new Promise((r) => setTimeout(r, SETUP_RETRY_MS))
        if (connectionNo !== this.connectionNo) return
      }
    }
  }

  async #setup() {
    this.ready = false
    this.backlog = []
    const user = await this.gateway.activeUser()
    if (!user) throw new Error("no active profile - start the CLI with --create-bot-display-name <name> --create-bot-allow-files")
    this.logger.info(`profile: ${user.name}`)
    await this.gateway.setFilesFolder(this.options.filesDir)
    await this.gateway.setBotCommands(this.options.botCommands)
    await this.gateway.acceptMemberContacts()
    const address = await this.gateway.ensureAddress()
    this.logger.info(`address: ${address}`)
    this.#writeState("address.txt", address)
    for (const link of this.options.groupLinks) {
      try {
        const result = await this.gateway.joinGroupLink(link)
        this.logger.info(`group link: ${result.status}${result.title ? ` (${result.title})` : ""}`)
      } catch (e) {
        this.logger.warn(`cannot join via ${link.slice(0, 40)}…: ${e.message}`)
      }
    }
    const groups = await this.#servedGroups()
    this.logger.info(groups.length > 0 ? `serving: ${groups.map((g) => `#${g.name}`).join(", ")}` : `no group matches "${this.options.group}" yet - invite me`)
    await this.keeper.scan(groups, this.options.scan)
    this.keeper.purge()
    this.outbox?.purgeOlderThan(OUTBOX_MAX_AGE_MS)
    await this.polls.start()
    this.ready = true
    const backlog = this.backlog
    this.backlog = []
    for (const event of backlog) this.#dispatch(event)
    this.logger.info("ready")
  }

  async #servedGroups() {
    return (await this.gateway.listGroups()).filter((g) => groupMatches(this.options.group, g) && g.memberStatus !== "invited" && g.memberStatus !== "left" && g.memberStatus !== "removed")
  }

  #dispatch(event) {
    if (!this.ready) {
      if (this.backlog.length >= MAX_BACKLOG) this.backlog.shift()
      this.backlog.push(event)
      return
    }
    this.#route(event).catch((e) => this.logger.error(`handling ${event.kind}: ${e.message}`))
  }

  async #route(event) {
    switch (event.kind) {
      case "message":
        return this.#routeMessage(event.message)
      case "messageDeleted":
        if (!this.#served(event.message.chat)) return
        this.keeper.onMessageDeleted(event.message)
        return this.polls.onMessageDeleted(event.message)
      case "fileReceived":
        return this.keeper.onFileReceived(event.file)
      case "fileFailed":
        return this.keeper.onFileFailed(event.file, event.reason)
      case "fileSent":
        return this.outbox?.release(event.file?.path)
      case "reaction":
        return this.polls.onReaction(event.reaction)
      case "groupInvitation":
        if (!groupMatches(this.options.group, event.group)) return this.logger.info(`ignoring the invitation to #${event.group.title}: not "${this.options.group}"`)
        this.logger.info(`joining #${event.group.title} (invited by ${event.from.name})`)
        return this.gateway.joinGroup(event.group.id)
      case "joinedGroup":
        if (!groupMatches(this.options.group, event.group)) return this.logger.warn(`joined #${event.group.title}, which is not "${this.options.group}" - not served`)
        this.logger.info(`joined #${event.group.title}`)
        return this.helper.greet(event.group)
      case "contactConnected":
        return this.gateway.sendText({type: "direct", id: event.contact.contactId, name: event.contact.name}, this.helper.texts.help())
      case "error":
        return this.logger.warn(`CLI reported: ${event.reason}`)
    }
  }

  /** Group history replayed to a new member is kept (files) but never answered (commands). */
  async #routeMessage(message) {
    if (message.isDirect) return this.helper.handle(message)
    if (!this.#served(message.chat)) return
    await this.keeper.handle(message, {quiet: message.isReplayed})
    if (message.isReplayed) return
    if (!(await this.courier.handle(message)) && !(await this.polls.handle(message))) await this.helper.handle(message)
  }

  #served(chat) {
    return chat.type === "group" && groupMatches(this.options.group, chat)
  }

  #writeState(fileName, content) {
    try {
      fs.mkdirSync(this.options.stateDir, {recursive: true})
      fs.writeFileSync(path.join(this.options.stateDir, fileName), content + "\n")
    } catch (e) {
      this.logger.warn(`cannot write ${fileName}: ${e.message}`)
    }
  }
}
