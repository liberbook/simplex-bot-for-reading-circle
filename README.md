# conatus

**English** · [Русский](README.ru.md) · [Українська](README.uk.md)

A small SimpleX Chat bot for a reading group: it **keeps every file the group
shares**, **hands one back on a word**, and **runs polls people vote in with
reactions**. Nothing else. Node >= 22, no npm dependencies, self-hosted.

Made for book clubs and study circles. Someone posts the scan, the recording,
the handout; three months later anyone gets it back by answering that post with
one word, instead of scrolling through a year of chat. The bot never speaks
unless it is asked.

Need more - class cards, a schedule, reminders, Spinoza's *Ethics*? Its bigger
sibling [spinoza](https://github.com/liberbook/simplex-bot-for-philosophy-circle) does all that on the same foundations.

## What it does

In the group:

| what happens | what the bot does |
| --- | --- |
| someone posts a file | downloads it into the archive, silently |
| someone deletes their post with a file, for everyone | moves the file to `deleted/`, erased after 30 days |
| `conatus` as a reply to a post with a file (or as a bare word right under it) | sends that file back, as a reply |
| `/vote Question? \| Option 1 \| Option 2` | posts one message; people vote with reactions. Add `multiple` to allow several choices |
| the author deletes their `/vote` post | the poll disappears together with the bot's message |
| `/?` | the short help, as a reply |

The word `conatus` inside a sentence, `vote` without a slash, and anything else
people say are left alone: the group is a conversation between humans. Any
private message to the bot gets the same short help.

Everything it says, with the message that provokes it, is in
[INTERFACE.md](INTERFACE.md) - generated from the code. Security notes: [SECURITY.md](SECURITY.md).

## Running it

```bash
git clone https://github.com/liberbook/simplex-bot-for-reading-circle.git conatus && cd conatus/deploy
mkdir -p data && cp ../conatus.example.json data/conatus.json   # group, language, limit, word
docker compose up -d --build
docker compose logs -f        # the bot's address: `address: https://…` (also in data/state/address.txt)
```

Connect to that address from a SimpleX app and invite the bot to your group. It
joins any group whose name matches `group` in the settings (or walks in by a
link from `groupLinks`). No admins and no secrets: whoever can invite it, does.

Without Docker:

```bash
simplex-chat -p 5225 -d ./db/chat --files-folder ./files --temp-folder ./tmp -y \
    --create-bot-display-name conatus --create-bot-allow-files
node src/main.js --group "Reading club"          # node src/main.js --help - every setting
```

## Settings

`conatus.json` next to the bot (or `--config`), `CONATUS_*` environment
variables, command-line flags; later wins.

| key | default | meaning |
| --- | --- | --- |
| `group` | `*` | which groups to serve (`*` is a wildcard) |
| `groupLinks` | `[]` | group links to join at start |
| `trigger` | `conatus` | the word that asks for a file |
| `language` | `en` | `en`, `ru`, `uk`, `it` - the language of everything the bot says |
| `maxStorage` | `100gb` | archive size limit |
| `deletedRetentionDays` | `30` | how long files of deleted posts are kept, `0` = forever |
| `scan` | `100` | how many recent messages to re-read at start, to catch up on missed files |
| `server`, `dir`, `deletedDir`, `stateDir` | | the CLI address and the folders (fixed inside Docker) |

## Translating it

Every text lives in one small file per language in [src/i18n/](src/i18n/), and
each is plain data - no code, no chat knowledge:

```js
noFileInPost: "There is no file in that post.",
whichFile: "Which file? Reply {trigger} to the post with the file.",
```

To add a language: copy [src/i18n/en.js](src/i18n/en.js), translate the values,
then import it in [src/i18n/languages.js](src/i18n/languages.js) and add it to
the map there. That is all - `npm test` then checks your file for missing keys,
stray placeholders and command words that do not parse.

Members may type a command in **any** of the languages, whatever the group's
own language is: `/vote`, `/sondaggio`, `/голосование` and `/голосування` all
open a poll.

## How it is built

```text
src/main.js               composition root: builds the objects, nothing else
src/config.js             settings: defaults < file < environment < flags
src/transport/            the CLI protocol: ChatConnection (WebSocket), SimplexClient (commands),
                          EventTranslator (CLI JSON -> domain events) - the only place with CLI field names
src/domain/Command.js     what a group message asks: /?, /vote, the trigger word; the rest is conversation
src/domain/Poll.js        a poll as data: parsing, ballots, counting
src/domain/Message.js     one normalised message
src/storage/Folder.js     a folder of files (archive, deleted): list, move, purge by age
src/storage/Outbox.js     copies of the files being sent, so the CLI never deletes an archived original
src/storage/PollStore.js  the polls, in one JSON file
src/bot/Keeper.js         downloads every file, moves a deleted post's file out, purges
src/bot/Courier.js        hands a file back on the trigger word
src/bot/Polls.js          polls: the message, the reactions, the deletion
src/bot/Helper.js         the help
src/bot/Bot.js            routes events, runs the whole thing
src/i18n/                 every text, one file per language
```

Behaviour classes get their gateway and their texts through the constructor and
know neither sockets nor JSON; the domain is pure functions.

```bash
npm test                 # unit tests, node:test, ~1 s (a fake gateway instead of the network)
npm run test:e2e         # the full scenario in Docker (~3 min): own relays, three users, the bot image
npm run doc              # regenerates INTERFACE.md from the code
```

## Data

```text
deploy/data/files/       the archive (also the CLI's files folder)
deploy/data/deleted/     files of deleted posts, 30 days
deploy/data/state/       polls.json, address.txt
deploy/data/db/          the CLI database: the bot's identity and keys - do not touch
```

Starting over: `docker compose down && sudo rm -rf data/{db,files,deleted,state,tmp} && docker compose up -d`
(a new identity - the bot has to be invited again).

## License

[GNU AGPL v3 or later](LICENSE). Copyright (C) 2026 conatus contributors.
Free software: you may use, study, share and change it, and anyone you pass it
on to - or who uses your modified copy over a network - gets the same freedoms
and the source. Not affiliated with SimpleX Chat; it runs as a client of the
official `simplex-chat` CLI.
