#!/usr/bin/env node
// conatus - a small SimpleX Chat bot for a reading group
// Copyright (C) 2026 conatus contributors
//
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. It comes with ABSOLUTELY NO WARRANTY; see the GNU AGPL
// <https://www.gnu.org/licenses/> and the LICENSE file for details.
// Composition root: builds the object graph and runs the bot.
import path from "node:path"
import {parseConfig, USAGE} from "./config.js"
import {Logger} from "./util/logger.js"
import {ChatConnection} from "./transport/ChatConnection.js"
import {SimplexClient} from "./transport/SimplexClient.js"
import {Folder} from "./storage/Folder.js"
import {Outbox} from "./storage/Outbox.js"
import {PollStore} from "./storage/PollStore.js"
import {texts as makeTexts} from "./i18n/index.js"
import {Keeper} from "./bot/Keeper.js"
import {Courier} from "./bot/Courier.js"
import {Polls} from "./bot/Polls.js"
import {Helper} from "./bot/Helper.js"
import {Bot} from "./bot/Bot.js"

let config
try {
  config = parseConfig(process.argv.slice(2), process.env)
} catch (e) {
  console.error(`error: ${e.message}\n`)
  console.error(USAGE)
  process.exit(2)
}
if (config.help) {
  console.log(USAGE)
  process.exit(0)
}

const logger = new Logger({verbose: config.verbose})
const texts = makeTexts(config.trigger, config.language)
const gateway = new SimplexClient(new ChatConnection(config.server, {logger}))
const archive = new Folder(config.dir)
const deleted = new Folder(config.deletedDir)
archive.ensure()
deleted.ensure()
const outbox = new Outbox(path.join(archive.dir, ".outbox")) // inside the archive (no listing shows a folder): the same filesystem, so copies are hard links
outbox.ensure()
const keeper = new Keeper({gateway, archive, deleted, texts, logger, maxBytes: config.maxStorageBytes, retentionMs: config.deletedRetentionDays * 86_400_000})
const bot = new Bot({
  gateway,
  keeper,
  courier: new Courier({gateway, keeper, outbox, texts, logger, trigger: config.trigger}),
  outbox,
  polls: new Polls({gateway, store: new PollStore(path.join(config.stateDir, "polls.json")), texts, logger, trigger: config.trigger}),
  helper: new Helper({gateway, texts, logger, trigger: config.trigger}),
  logger,
  options: {filesDir: archive.dir, stateDir: config.stateDir, group: config.group, groupLinks: config.groupLinks, scan: config.scan, botCommands: texts.botCommands()},
})

logger.info(`conatus${process.env.CONATUS_BUILD ? ` (${process.env.CONATUS_BUILD})` : ""}: archive ${archive.dir} (limit ${config.maxStorage}), deleted ${deleted.dir} (kept ${config.deletedRetentionDays} days), group "${config.group}", trigger "${config.trigger}", language ${config.language}`)
const shutdown = () => {
  logger.info("stopping")
  bot.stop()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
bot.run().catch((e) => {
  logger.error(e.message)
  process.exit(1)
})
