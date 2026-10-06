import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {Bot} from "../../src/bot/Bot.js"
import {Helper} from "../../src/bot/Helper.js"
import {Folder} from "../../src/storage/Folder.js"
import {Keeper} from "../../src/bot/Keeper.js"
import {Courier} from "../../src/bot/Courier.js"
import {Polls} from "../../src/bot/Polls.js"
import {PollStore} from "../../src/storage/PollStore.js"
import {ALICE, FakeGateway, GROUP, OTHER_GROUP, directMessage, groupMessage, offer, silentLogger, texts} from "./helpers.js"

/** A gateway whose events the test emits itself. */
class EventGateway extends FakeGateway {
  onEvent(fn) {
    this.emit = fn
  }
  onOpen(fn) {
    this.open = fn
  }
  async start() {
    await this.open()
  }
  stop() {}
}

async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conatus-"))
  const gateway = new EventGateway({groups: [GROUP, OTHER_GROUP, {...GROUP, id: 9, name: "invited", title: "Ethics", memberStatus: "invited"}]})
  const archive = new Folder(path.join(root, "files"))
  archive.ensure()
  const keeper = new Keeper({gateway, archive, deleted: new Folder(path.join(root, "deleted")), texts, logger: silentLogger, maxBytes: 1e9, retentionMs: 0})
  const polls = new Polls({gateway, store: new PollStore(path.join(root, "polls.json")), texts, logger: silentLogger, trigger: "conatus"})
  const bot = new Bot({
    gateway,
    keeper,
    courier: new Courier({gateway, keeper, texts, logger: silentLogger, trigger: "conatus"}),
    polls,
    helper: new Helper({gateway, texts, logger: silentLogger, trigger: "conatus"}),
    logger: silentLogger,
    options: {filesDir: archive.dir, stateDir: path.join(root, "state"), group: "Ethics", groupLinks: ["https://simplex.chat/contact#g"], scan: 10, botCommands: texts.botCommands()},
  })
  gateway.recent = [groupMessage({itemId: 1, file: offer({id: 1, name: "missed.pdf"})})]
  await bot.run()
  await new Promise((r) => setImmediate(r))
  return {bot, gateway, root}
}

test("start-up: files folder, commands, address written, group links joined, history scanned quietly", async () => {
  const {gateway, root} = await setup()
  assert.equal(fs.readFileSync(path.join(root, "state", "address.txt"), "utf8").trim(), "https://simplex.chat/contact#address")
  assert.deepEqual(gateway.joinedLinks, ["https://simplex.chat/contact#g"])
  assert.match(gateway.botCommands, /^'Help':\/\?,/)
  assert.deepEqual(gateway.received, [1], "the missed file of the served group")
  assert.deepEqual(gateway.sent, [])
})

test("routing: served groups only, replayed history is kept but never answered, private messages get the help", async () => {
  const {gateway} = await setup()
  const emit = async (event) => {
    gateway.emit(event)
    await new Promise((r) => setImmediate(r))
  }
  await emit({kind: "message", message: groupMessage({itemId: 50, text: "/?"})})
  assert.equal(gateway.sent.at(-1).text, texts.help())
  assert.equal(gateway.sent.at(-1).quotedItemId, 50)
  await emit({kind: "message", message: groupMessage({itemId: 51, text: "/?", chat: OTHER_GROUP})})
  await emit({kind: "message", message: groupMessage({itemId: 52, text: "/?", forwarded: true})})
  await emit({kind: "message", message: groupMessage({itemId: 53, file: offer({id: 2, name: "replayed.pdf"}), forwarded: true})})
  assert.equal(gateway.sent.length, 1, "other groups and replayed commands: silence")
  assert.deepEqual(gateway.received, [1, 2], "a replayed file is still kept")
  await emit({kind: "message", message: directMessage("привет")})
  assert.equal(gateway.sent.at(-1).text, texts.help())
  await emit({kind: "contactConnected", contact: {contactId: 8, name: "dan"}})
  assert.deepEqual(gateway.sent.at(-1).chat, {type: "direct", id: 8, name: "dan"})
  await emit({kind: "groupInvitation", group: {id: 11, name: "e2", title: "Ethics"}, from: ALICE})
  await emit({kind: "groupInvitation", group: {id: 12, name: "r", title: "Random"}, from: ALICE})
  assert.deepEqual(gateway.joined, [11])
  await emit({kind: "joinedGroup", group: {type: "group", id: 11, name: "e2", title: "Ethics"}})
  assert.equal(gateway.sent.at(-1).text, texts.help(), "greets the group it joined")
  await emit({kind: "message", message: groupMessage({itemId: 60, text: "/v A? | b | c"})})
  await emit({kind: "reaction", reaction: {chat: GROUP, itemId: gateway.nextItemId - 1, sender: ALICE, emoji: "👍", added: true}})
  await emit({kind: "messageDeleted", message: groupMessage({itemId: 60, text: "/v A? | b | c"})})
  assert.equal(gateway.deletions.length, 1, "the poll went with its post")
})
