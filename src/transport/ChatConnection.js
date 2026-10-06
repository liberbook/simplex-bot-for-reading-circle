/**
 * WebSocket connection to the simplex-chat CLI running with `-p <port>`.
 *
 * Responsibilities (and nothing else): framing of requests/responses with
 * correlation ids, request timeouts, delivery of unsolicited events, and
 * automatic reconnection. Knows nothing about chat semantics.
 */
export class ChatConnection {
  /**
   * @param {string} url e.g. ws://127.0.0.1:5225
   * @param {{logger: import("../util/logger.js").Logger, timeoutMs?: number, reconnectMs?: number}} deps
   */
  constructor(url, {logger, timeoutMs = 30_000, reconnectMs = 3_000}) {
    this.url = url
    this.logger = logger
    this.timeoutMs = timeoutMs
    this.reconnectMs = reconnectMs
    this.ws = null
    this.nextCorrId = 0
    this.pending = new Map() // corrId -> {resolve, reject, timer}
    this.eventListeners = []
    this.openListeners = []
    this.stopped = false
  }

  /** Register a listener for unsolicited CLI events (raw JSON `resp` objects). */
  onEvent(fn) {
    this.eventListeners.push(fn)
  }

  /** Register a listener called every time the socket (re)opens. */
  onOpen(fn) {
    this.openListeners.push(fn)
  }

  /** Connect and keep reconnecting until stop() is called. Resolves on first open. */
  start() {
    return new Promise((resolveFirstOpen) => {
      let first = true
      const attempt = () => {
        if (this.stopped) return
        const ws = new WebSocket(this.url)
        this.ws = ws
        let opened = false

        // Depending on the Node version a failed connect fires "error" only,
        // or "error" then "close" - treat the first of them as the end.
        let ended = false
        const onEnded = () => {
          if (ended) return
          ended = true
          this.#failPending(new Error("connection closed"))
          if (this.stopped) return
          this.logger.warn(
            opened
              ? `connection lost, reconnecting in ${this.reconnectMs / 1000}s`
              : `cannot connect to ${this.url} - is "simplex-chat -p <port>" running? retrying in ${this.reconnectMs / 1000}s`
          )
          setTimeout(attempt, this.reconnectMs)
        }

        ws.addEventListener("open", () => {
          opened = true
          this.logger.info(`connected to ${this.url}`)
          for (const fn of this.openListeners) fn()
          if (first) {
            first = false
            resolveFirstOpen()
          }
        })
        ws.addEventListener("message", (ev) => this.#receive(ev.data))
        ws.addEventListener("error", onEnded)
        ws.addEventListener("close", onEnded)
      }
      attempt()
    })
  }

  stop() {
    this.stopped = true
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
  }

  /** Send a CLI command string; resolves with the raw response object. */
  send(cmd) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error("not connected"))
      const corrId = String(++this.nextCorrId)
      const timer = setTimeout(() => {
        this.pending.delete(corrId)
        reject(new Error(`command timed out: ${cmd.slice(0, 80)}`))
      }, this.timeoutMs)
      this.pending.set(corrId, {resolve, reject, timer})
      this.logger.debug(`>> ${cmd.slice(0, 200)}`)
      this.ws.send(JSON.stringify({corrId, cmd}))
    })
  }

  #receive(data) {
    let msg
    try {
      msg = JSON.parse(data)
    } catch {
      this.logger.debug(`unparsable message: ${String(data).slice(0, 200)}`)
      return
    }
    if (msg.corrId != null) {
      const req = this.pending.get(msg.corrId)
      if (!req) return
      this.pending.delete(msg.corrId)
      clearTimeout(req.timer)
      req.resolve(msg.resp)
    } else if (msg.resp?.type) {
      this.logger.debug(`<< event ${msg.resp.type} ${JSON.stringify(msg.resp).slice(0, 400)}`)
      for (const fn of this.eventListeners) {
        try {
          fn(msg.resp)
        } catch (e) {
          // an event shape we did not expect must not stop the bot (bots/README: ignore what you cannot process)
          this.logger.warn(`cannot process event ${msg.resp.type}: ${e.message}`)
        }
      }
    }
  }

  #failPending(err) {
    for (const {reject, timer} of this.pending.values()) {
      clearTimeout(timer)
      reject(err)
    }
    this.pending.clear()
  }
}
