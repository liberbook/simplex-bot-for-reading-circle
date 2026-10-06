/**
 * Tiny leveled logger writing to stdout/stderr; injected wherever logging is
 * needed. An optional `redact` function is applied to every line (used to
 * hide anything sensitive).
 */
export class Logger {
  constructor({verbose = false, out = console, redact = (s) => s} = {}) {
    this.verbose = verbose
    this.out = out
    this.redact = redact
  }

  info(msg) {
    this.out.log(`${stamp()} ${this.redact(msg)}`)
  }

  warn(msg) {
    this.out.error(`${stamp()} warning: ${this.redact(msg)}`)
  }

  error(msg) {
    this.out.error(`${stamp()} error: ${this.redact(msg)}`)
  }

  debug(msg) {
    if (this.verbose) this.out.log(`${stamp()} [debug] ${this.redact(msg)}`)
  }
}

function stamp() {
  return `[${new Date().toISOString().slice(11, 19)}]`
}

/** Logger that drops everything; used in tests. */
export const silentLogger = new Logger({out: {log() {}, error() {}}})
