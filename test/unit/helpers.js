import {Message} from "../../src/domain/Message.js"

/** In-memory stand-in for SimplexClient recording what the bot asked for. */
export class FakeGateway {
  constructor({groups = [GROUP], items = {}, recent = []} = {}) {
    this.groups = groups
    this.items = items // `${groupId}:${itemId}` -> Message
    this.recent = recent // Messages returned by recentMessages(), oldest first
    this.received = [] // file ids passed to receiveFile
    this.sent = [] // {chat, text, quotedItemId} | {chat, filePath, quotedItemId}
    this.edits = [] // {chat, itemId, text}
    this.deletions = [] // {chat, itemId}
    this.reactions = {} // `${groupId}:${itemId}:${emoji}` -> members
    this.receiveResult = {ok: true}
    this.nextItemId = 100
  }
  async activeUser() {
    return {userId: 1, name: "conatus"}
  }
  async setFilesFolder() {}
  async setBotCommands(spec) {
    this.botCommands = spec
  }
  async acceptMemberContacts() {
    this.acceptsMemberContacts = true
  }
  async ensureAddress() {
    return "https://simplex.chat/contact#address"
  }
  async joinGroupLink(link) {
    this.joinedLinks = [...(this.joinedLinks ?? []), link]
    return {status: "connecting", title: "linked"}
  }
  async joinGroup(groupId) {
    this.joined = [...(this.joined ?? []), groupId]
  }
  async listGroups() {
    return this.groups
  }
  async recentMessages() {
    return this.recent
  }
  async messageById(groupId, itemId) {
    return this.items[`${groupId}:${itemId}`] ?? null
  }
  async receiveFile(fileId) {
    this.received.push(fileId)
    return this.receiveResult
  }
  async sendText(chat, text, quotedItemId = null) {
    this.sent.push({chat, text, ...(quotedItemId !== null ? {quotedItemId} : {})})
    return this.nextItemId++
  }
  async sendFile(chat, filePath, quotedItemId = null) {
    this.sent.push({chat, filePath, ...(quotedItemId !== null ? {quotedItemId} : {})})
  }
  async editText(chat, itemId, text) {
    this.edits.push({chat, itemId, text})
  }
  async deleteMessage(chat, itemId) {
    this.deletions.push({chat, itemId})
  }
  async reactionMembers(groupId, itemId, emoji) {
    return this.reactions[`${groupId}:${itemId}:${emoji}`] ?? []
  }
}

export const GROUP = {type: "group", id: 1, name: "ethics", title: "Ethics", memberStatus: "connected"}
export const OTHER_GROUP = {type: "group", id: 2, name: "random", title: "Random", memberStatus: "connected"}
export const ALICE = {contactId: 3, name: "alice", memberId: 2}
export const BOB = {contactId: 4, name: "bob", memberId: 5}
export const DIRECT_ALICE = {type: "direct", id: 3, name: "alice"}

export function groupMessage(overrides = {}) {
  return new Message({chat: GROUP, sender: ALICE, incoming: true, itemId: 10, text: "", ...overrides})
}

export function directMessage(text, overrides = {}) {
  return new Message({chat: DIRECT_ALICE, sender: ALICE, incoming: true, itemId: 20, text, ...overrides})
}

export function offer(overrides = {}) {
  return {id: 7, name: "report.pdf", size: 1024, status: "rcvInvitation", path: null, contentType: "file", ...overrides}
}

export const texts = (await import("../../src/i18n/index.js")).texts("conatus")
/** The same texts in another language, for the tests that check the bot speaks it. */
export const textsIn = async (language) => (await import("../../src/i18n/index.js")).texts("conatus", language)
export const silentLogger = (await import("../../src/util/logger.js")).silentLogger
