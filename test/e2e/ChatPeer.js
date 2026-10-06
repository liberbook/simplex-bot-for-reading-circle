/**
 * Minimal WebSocket client for driving a simplex-chat CLI in tests: sends
 * commands, remembers every event so waits are race-free.
 */
export class ChatPeer {
  constructor(name, ws) {
    this.name = name
    this.ws = ws
    this.nextId = 0
    this.pending = new Map()
    this.events = []
    this.waiters = []
    ws.addEventListener("message", (ev) => this.#onMessage(ev.data))
  }

  static async connect(name, url, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        const ws = new WebSocket(url)
        await new Promise((resolve, reject) => {
          // a failed connect fires "error" (Node 22) or "error"+"close" (Node 26)
          ws.addEventListener("open", resolve, {once: true})
          ws.addEventListener("error", () => reject(new Error("connect failed")), {once: true})
          ws.addEventListener("close", () => reject(new Error("closed")), {once: true})
        })
        return new ChatPeer(name, ws)
      } catch {
        if (Date.now() > deadline) throw new Error(`${name}: cannot connect to ${url}`)
        await sleep(1000)
      }
    }
  }

  cmd(command, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const id = String(++this.nextId)
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.name}: timeout for ${command.slice(0, 60)}`))
      }, timeoutMs)
      this.pending.set(id, (resp) => {
        clearTimeout(timer)
        resolve(resp)
      })
      this.ws.send(JSON.stringify({corrId: id, cmd: command}))
    })
  }

  /** Command that must return one of the given response types. */
  async expect(command, types, timeoutMs) {
    const r = await this.cmd(command, timeoutMs)
    if (!types.includes(r.type)) throw new Error(`${this.name}: ${command.slice(0, 60)} -> ${r.type} ${JSON.stringify(r).slice(0, 300)}`)
    return r
  }

  /** Resolves with the first event (past or future) satisfying the predicate. */
  waitEvent(description, predicate, timeoutMs = 60_000) {
    const seen = this.events.find(predicate)
    if (seen) return Promise.resolve(seen)
    return new Promise((resolve, reject) => {
      const waiter = {predicate, resolve: null}
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter)
        const recent = this.events.slice(-8).map((e) => e.type).join(", ")
        const lastError = this.events.filter((e) => e.type === "chatError" || e.type === "chatCmdError").at(-1)
        reject(new Error(`${this.name}: timeout waiting for ${description} (recent events: ${recent})${lastError ? `\n       last error: ${JSON.stringify(lastError).slice(0, 400)}` : ""}`))
      }, timeoutMs)
      waiter.resolve = (ev) => {
        clearTimeout(timer)
        resolve(ev)
      }
      this.waiters.push(waiter)
    })
  }

  /** First incoming direct text message satisfying the predicate (optionally from a given contact). */
  waitDirectText(description, predicate, {from = null, timeoutMs = 60_000} = {}) {
    const pick = (e) =>
      e.type === "newChatItems"
        ? e.chatItems.find(
            ({chatInfo, chatItem}) =>
              chatItem.chatDir?.type === "directRcv" &&
              (from === null || chatInfo.contact?.localDisplayName === from) &&
              chatItem.content?.msgContent?.type === "text" &&
              predicate(chatItem.content.msgContent.text)
          )
        : undefined
    return this.waitEvent(description, (e) => pick(e) !== undefined, timeoutMs).then((e) => pick(e).chatItem.content.msgContent.text)
  }

  /** First incoming group text message satisfying the predicate (optionally from a given member). */
  waitGroupText(description, predicate, {from = null, timeoutMs = 60_000} = {}) {
    const pick = (e) =>
      e.type === "newChatItems"
        ? e.chatItems.find(
            ({chatItem}) =>
              chatItem.chatDir?.type === "groupRcv" &&
              (from === null || chatItem.chatDir.groupMember?.localDisplayName === from) &&
              chatItem.content?.msgContent?.type === "text" &&
              predicate(chatItem.content.msgContent.text)
          )
        : undefined
    return this.waitEvent(description, (e) => pick(e) !== undefined, timeoutMs).then((e) => pick(e).chatItem.content.msgContent.text)
  }

  /** First incoming group chat item (text or file) satisfying the predicate, optionally from a given member; resolves with the raw chat item. */
  waitGroupItem(description, predicate, {from = null, timeoutMs = 60_000} = {}) {
    const pick = (e) =>
      e.type === "newChatItems"
        ? e.chatItems.find(({chatItem}) => chatItem.chatDir?.type === "groupRcv" && (from === null || chatItem.chatDir.groupMember?.localDisplayName === from) && predicate(chatItem))
        : undefined
    return this.waitEvent(description, (e) => pick(e) !== undefined, timeoutMs).then((e) => pick(e).chatItem)
  }

  /** First received file offer with the given name and direction ("groupRcv" | "directRcv"). */
  waitFileOffer(fileName, direction, timeoutMs = 60_000) {
    const pick = (e) =>
      e.type === "newChatItems"
        ? e.chatItems.find(({chatItem}) => chatItem.chatDir?.type === direction && chatItem.file?.fileName === fileName && chatItem.file?.fileStatus?.type === "rcvInvitation")
        : undefined
    return this.waitEvent(`${direction} file offer ${fileName}`, (e) => pick(e) !== undefined, timeoutMs).then(pick)
  }

  close() {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }

  #onMessage(data) {
    let msg
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    if (msg.corrId != null) {
      const done = this.pending.get(msg.corrId)
      if (done) {
        this.pending.delete(msg.corrId)
        done(msg.resp)
      }
      return
    }
    if (!msg.resp?.type) return
    this.events.push(msg.resp)
    for (const w of [...this.waiters]) {
      if (w.predicate(msg.resp)) {
        this.waiters = this.waiters.filter((x) => x !== w)
        w.resolve(msg.resp)
      }
    }
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
