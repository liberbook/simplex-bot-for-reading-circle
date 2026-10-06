import {Message} from "../domain/Message.js"

/**
 * Translates raw simplex-chat CLI JSON (chat items and events) into the
 * bot's domain vocabulary. This is the only place that knows the CLI's
 * field names, so protocol changes are contained here.
 *
 * Domain events produced by translateEvent():
 *   {kind: "message", message: Message}
 *   {kind: "messageUpdated", message: Message}   - a message was edited by its author
 *   {kind: "messageDeleted", message: Message}   - a message was deleted for everyone (by its author or a moderator)
 *   {kind: "contactConnected", contact: {contactId, name}}
 *   {kind: "contactDeleted", contact: {contactId, name}}   - the other side deleted the chat with the bot
 *   {kind: "groupInvitation", group: {id, name, title}, from: {contactId, name}}
 *   {kind: "fileReceived", file: FileOffer}
 *   {kind: "fileFailed", file: FileOffer|null, reason: string}
 *   {kind: "fileSent", file: FileOffer}
 *   {kind: "joinedGroup", group: {id, name, title}}   - the bot completed joining a group
 *   {kind: "reaction", reaction: {chat, itemId, sender, emoji, added}} - someone (un)reacted to a message
 *   {kind: "error", reason: string}          - asynchronous CLI/agent error
 */

/** @returns {Message|null} null for items that are not user messages (e.g. system events) */
export function chatItemToMessage({chatInfo, chatItem}) {
  const chat = chatRef(chatInfo)
  if (!chat) return null
  const content = chatItem.content
  if (content?.type !== "rcvMsgContent" && content?.type !== "sndMsgContent") return null
  const dir = chatItem.chatDir?.type
  return new Message({
    chat,
    sender: sender(chatInfo, chatItem),
    incoming: dir === "directRcv" || dir === "groupRcv",
    itemId: chatItem.meta.itemId,
    text: content.msgContent?.text ?? "",
    file: fileOffer(chatItem.file, content.msgContent?.type),
    quotedItemId: chatItem.quotedItem?.itemId ?? null, // null for a quoted post the bot never received
    isReply: chatItem.quotedItem != null,
    deleted: chatItem.meta?.itemDeleted != null,
    sentAt: chatItem.meta?.itemTs ? new Date(chatItem.meta.itemTs) : null,
    forwarded: chatItem.meta?.forwardedByMember != null,
  })
}

/** @returns {object[]} zero or more domain events for one raw CLI event */
export function translateEvent(raw) {
  switch (raw.type) {
    case "newChatItems":
      return raw.chatItems
        .map(chatItemToMessage)
        .filter(Boolean)
        .map((message) => ({kind: "message", message}))
    case "chatItemsDeleted":
      if (raw.byUser) return [] // the bot's own deletions
      return (raw.chatItemDeletions ?? [])
        .map((d) => (d.deletedChatItem ? chatItemToMessage(d.deletedChatItem) : null))
        .filter(Boolean)
        .map((message) => ({kind: "messageDeleted", message}))
    case "chatItemUpdated": {
      const message = raw.chatItem ? chatItemToMessage(raw.chatItem) : null
      return message ? [{kind: "messageUpdated", message}] : []
    }
    case "contactConnected":
      return [{kind: "contactConnected", contact: {contactId: raw.contact.contactId, name: safeName(raw.contact.localDisplayName)}}]
    case "contactDeletedByContact":
      return [{kind: "contactDeleted", contact: {contactId: raw.contact.contactId, name: safeName(raw.contact.localDisplayName)}}]
    case "receivedGroupInvitation":
      return [
        {
          kind: "groupInvitation",
          group: groupRef(raw.groupInfo),
          from: {contactId: raw.contact?.contactId ?? null, name: safeName(raw.contact?.localDisplayName)},
        },
      ]
    case "rcvFileComplete":
      return [{kind: "fileReceived", file: fileOffer(raw.chatItem?.chatItem?.file)}]
    case "rcvFileError":
      return [{kind: "fileFailed", file: fileOffer(raw.chatItem_?.chatItem?.file) ?? fileFromTransfer(raw.rcvFileTransfer), reason: JSON.stringify(raw.agentError)}]
    case "rcvFileSndCancelled":
      return [{kind: "fileFailed", file: fileOffer(raw.chatItem?.chatItem?.file) ?? fileFromTransfer(raw.rcvFileTransfer), reason: "sender cancelled the transfer"}]
    case "sndFileCompleteXFTP":
      return [{kind: "fileSent", file: fileOffer(raw.chatItem?.chatItem?.file)}]
    case "userJoinedGroup":
      return [{kind: "joinedGroup", group: groupRef(raw.groupInfo)}]
    case "chatItemReaction": {
      const r = raw.reaction
      const chat = chatRef(r?.chatInfo)
      const item = r?.chatReaction?.chatItem
      const emoji = r?.chatReaction?.reaction?.emoji
      if (!chat || !item || !emoji) return []
      return [{kind: "reaction", reaction: {chat, itemId: item.meta.itemId, sender: sender(r.chatInfo, r.chatReaction), emoji, added: Boolean(raw.added)}}]
    }
    case "chatError":
      return [{kind: "error", reason: describeError(raw)}]
    default:
      return []
  }
}

/** Human-readable summary of a CLI error response or event. */
export function describeError(response) {
  if (response?.type === "chatCmdError" || response?.type === "chatError") {
    const e = response.chatError
    if (e?.type === "error") return e.errorType?.type + (e.errorType?.message ? ` (${e.errorType.message})` : "")
    if (e?.type === "errorStore") return e.storeError?.type ?? JSON.stringify(e)
    return JSON.stringify(e)
  }
  return response?.type ?? JSON.stringify(response)
}

/**
 * Group reference. `name` is the bot's local name for the group (unique,
 * may get a "_1" suffix), `title` the group's own display name, and
 * `memberStatus` the bot's own membership status (e.g. "invited", "connected").
 */
export function groupRef(groupInfo) {
  return {
    type: "group",
    id: groupInfo.groupId,
    name: safeName(groupInfo.localDisplayName),
    title: safeName(groupInfo.groupProfile?.displayName ?? groupInfo.localDisplayName),
    memberStatus: groupInfo.membership?.memberStatus ?? "unknown",
  }
}

export function memberRef(member) {
  return {contactId: member.memberContactId ?? null, name: safeName(member.localDisplayName), status: member.memberStatus, role: member.memberRole}
}

/**
 * Display names come from other people's profiles. Control characters and
 * line breaks are removed so a name can neither forge log lines nor inject
 * extra lines into the bot's own messages; length is capped.
 */
export function safeName(name) {
  const cleaned = String(name ?? "")
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)
  return cleaned || "unknown"
}

function chatRef(chatInfo) {
  if (chatInfo?.type === "direct") {
    return {type: "direct", id: chatInfo.contact.contactId, name: safeName(chatInfo.contact.localDisplayName)}
  }
  if (chatInfo?.type === "group" && !chatInfo.groupChatScope) {
    const {id, name, title} = groupRef(chatInfo.groupInfo)
    return {type: "group", id, name, title}
  }
  return null // local notes, contact requests, member support chats...
}

function sender(chatInfo, chatItem) {
  const member = chatItem.chatDir?.groupMember
  if (member) return {contactId: member.memberContactId ?? null, name: safeName(member.localDisplayName), memberId: member.groupMemberId}
  if (chatInfo.type === "direct") return {contactId: chatInfo.contact.contactId, name: safeName(chatInfo.contact.localDisplayName)}
  return {contactId: null, name: "me"}
}

/** File identity from a RcvFileTransfer record (present on file errors even when the chat item is not). */
function fileFromTransfer(transfer) {
  if (!transfer?.fileId) return null
  return {
    id: transfer.fileId,
    name: transfer.fileInvitation?.fileName ?? "?",
    size: transfer.fileInvitation?.fileSize ?? 0,
    status: "error",
    path: null,
  }
}

function fileOffer(file, contentType = "file") {
  if (!file) return null
  return {
    id: file.fileId,
    name: file.fileName,
    size: file.fileSize,
    status: file.fileStatus?.type ?? "unknown",
    path: file.fileSource?.filePath ?? null,
    contentType, // "file" | "image" | "video" | "voice"
  }
}
