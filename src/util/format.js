const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"]
const MULTIPLIERS = {b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4}

/** "100gb" | "512 MB" | "1048576" -> bytes (binary multiples). */
export function parseSize(text) {
  const m = String(text).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([kmgt]?b)?$/)
  if (!m) throw new Error(`invalid size: "${text}" (use e.g. 100gb, 512mb)`)
  return Math.floor(Number(m[1]) * MULTIPLIERS[m[2] ?? "b"])
}

export function formatSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "?"
  let n = bytes
  let i = 0
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${UNITS[i]}`
}
