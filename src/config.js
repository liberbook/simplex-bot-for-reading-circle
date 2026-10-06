import fs from "node:fs"
import path from "node:path"
import {parseArgs} from "node:util"
import {parseSize} from "./util/format.js"
import {DEFAULT_LANGUAGE, LANGUAGES, languageList} from "./i18n/languages.js"

/**
 * Settings: defaults < config file (JSON) < environment (CONATUS_*) < flags.
 * The result is a frozen plain object; nothing else reads argv, env or files.
 */
const DEFAULTS = Object.freeze({
  server: "ws://127.0.0.1:5225",
  dir: "./files",
  deletedDir: "./deleted",
  deletedRetentionDays: 30,
  stateDir: "./state",
  group: "*",
  groupLinks: [],
  trigger: "conatus",
  language: DEFAULT_LANGUAGE,
  scan: 100,
  maxStorage: "100gb",
  verbose: false,
})

// setting -> [environment variable, kind, flag]
const OPTIONS = {
  server: ["CONATUS_SERVER", "string", "server"],
  dir: ["CONATUS_DIR", "string", "dir"],
  deletedDir: ["CONATUS_DELETED_DIR", "string", "deleted-dir"],
  deletedRetentionDays: ["CONATUS_DELETED_RETENTION_DAYS", "integer", "deleted-retention-days"],
  stateDir: ["CONATUS_STATE_DIR", "string", "state-dir"],
  group: ["CONATUS_GROUP", "string", "group"],
  groupLinks: ["CONATUS_GROUP_LINKS", "list", "group-link"],
  trigger: ["CONATUS_TRIGGER", "string", "trigger"],
  language: ["CONATUS_LANGUAGE", "string", "language"],
  scan: ["CONATUS_SCAN", "integer", "scan"],
  maxStorage: ["CONATUS_MAX_STORAGE", "string", "max-storage"],
  verbose: ["CONATUS_VERBOSE", "boolean", "verbose"],
}

export const USAGE = `conatus - keeps every file shared in a SimpleX group

Usage: node src/main.js [options]      settings: defaults < config file < CONATUS_* env < option

  -c, --config <file>              JSON config file (./conatus.json if present)
      --server <url>               WebSocket URL of the simplex-chat CLI (ws://127.0.0.1:5225)
      --dir <folder>               the archive = the CLI files folder (./files)
      --deleted-dir <folder>       files of deleted posts go here (./deleted)
      --deleted-retention-days <N> purge them after N days, 0 = keep (30)
      --state-dir <folder>         polls, address (./state)
      --group <pattern>            group(s) to serve, * = any (*)
      --group-link <link>          group link to join at start (repeatable)
      --trigger <word>             the word that asks for a file (conatus)
      --language <code>            language of everything the bot says (en)
                                   ${languageList().join(", ")}
      --scan <N>                   on start re-check the last N group messages (100)
      --max-storage <size>         archive size limit, e.g. 100gb (100gb)
  -v, --verbose                    debug logging
  -h, --help
`

export function parseConfig(argv, env = {}) {
  const options = Object.fromEntries(Object.entries(OPTIONS).map(([, [, kind, flag]]) => [flag, kind === "boolean" ? {type: "boolean"} : {type: "string", multiple: kind === "list"}]))
  const {values: flags} = parseArgs({args: argv, options: {...options, config: {type: "string", short: "c"}, help: {type: "boolean", short: "h"}, verbose: {type: "boolean", short: "v"}}})
  if (flags.help) return {help: true}
  const fromFile = readConfigFile(flags.config ?? env.CONATUS_CONFIG ?? null)
  const merged = {...DEFAULTS, ...fromFile}
  for (const [key, [envName, kind, flag]] of Object.entries(OPTIONS)) {
    if (env[envName] !== undefined) merged[key] = coerce(env[envName], kind, envName)
    if (flags[flag] !== undefined) merged[key] = coerce(flags[flag], kind, `--${flag}`)
  }
  return validate(merged, env)
}

function validate(c, env) {
  for (const key of ["scan", "deletedRetentionDays"]) {
    c[key] = coerce(c[key], "integer", key)
    if (c[key] < 0) throw new Error(`${key} must not be negative`)
  }
  const trigger = String(c.trigger).trim()
  if (!/^\p{L}+$/u.test(trigger)) throw new Error("trigger must be one word")
  const language = String(c.language).trim().toLowerCase()
  if (!(language in LANGUAGES)) throw new Error(`unknown language "${language}" - known: ${languageList().join(", ")}`)
  const dir = path.resolve(expandHome(String(c.dir), env.HOME))
  const deletedDir = path.resolve(expandHome(String(c.deletedDir), env.HOME))
  if (deletedDir === dir) throw new Error("deletedDir must differ from dir")
  return Object.freeze({
    help: false,
    server: String(c.server),
    dir,
    deletedDir,
    deletedRetentionDays: c.deletedRetentionDays,
    stateDir: path.resolve(expandHome(String(c.stateDir), env.HOME)),
    group: String(c.group),
    groupLinks: coerce(c.groupLinks, "list", "groupLinks").map(String),
    trigger,
    language,
    scan: c.scan,
    maxStorage: String(c.maxStorage),
    maxStorageBytes: parseSize(c.maxStorage),
    verbose: Boolean(c.verbose),
  })
}

function readConfigFile(explicitPath) {
  const file = explicitPath ?? (fs.existsSync("conatus.json") ? "conatus.json" : null)
  if (!file) return {}
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    throw new Error(`cannot read config file ${file}: ${e.message}`)
  }
  for (const key of Object.keys(parsed)) if (!(key in OPTIONS)) throw new Error(`unknown setting "${key}" in ${file} (known: ${Object.keys(OPTIONS).join(", ")})`)
  return parsed
}

function coerce(value, kind, what) {
  switch (kind) {
    case "integer": {
      const n = Number.parseInt(String(value), 10)
      if (!Number.isInteger(n)) throw new Error(`${what} must be an integer`)
      return n
    }
    case "boolean":
      return typeof value === "boolean" ? value : !["", "0", "false", "no", "off"].includes(String(value).toLowerCase())
    case "list":
      return Array.isArray(value) ? value : String(value).split(",").map((s) => s.trim()).filter(Boolean)
    default:
      return String(value)
  }
}

function expandHome(p, home) {
  return home && p.startsWith("~/") ? path.join(home, p.slice(2)) : p
}
