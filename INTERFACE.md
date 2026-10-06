# What the bot says

Generated from the code: the messages below are produced by the very classes the
bot runs (`scripts/interface-doc.js`), so they are what a member really sees.
Regenerate with `npm run doc`; `test/unit/interface.test.js` fails when this file
falls behind the code.

The examples use the default language (English) - the same texts exist in every
language of `src/i18n/` (en English, ru Русский, uk Українська, it Italiano).
Setting: group "Ethics", trigger word `conatus`, archive limit 100 KiB; `sam` and
`lena` are members of the group.

1. [Help](#help)
2. [Files](#files)
3. [Polls](#polls)
4. [What the bot leaves alone](#what-the-bot-leaves-alone)
5. [The command menu](#the-command-menu)

## Help

One help text, in three places: any private message, `/?` in the group, and the greeting when the bot joins a group.

**Someone connects to the bot** - the first message in the private chat

```text
[into the private chat]
I keep every file this group shares.
To get a file back, reply conatus to the post with it - I will send it back.

Poll: /vote Question? | Option 1 | Option 2
People vote with reactions. Delete your post and the poll is gone.
```

**Any private message, e.g. "hello"**

```text
[into the private chat]
I keep every file this group shares.
To get a file back, reply conatus to the post with it - I will send it back.

Poll: /vote Question? | Option 1 | Option 2
People vote with reactions. Delete your post and the poll is gone.
```

**`/?` in the group** - also `/??` and each language's word: `/help`, `/aiuto`, `/помощь`, `/довідка`

```text
[as a reply]
I keep every file this group shares.
To get a file back, reply conatus to the post with it - I will send it back.

Poll: /vote Question? | Option 1 | Option 2
People vote with reactions. Delete your post and the poll is gone.
```

**The bot joined a group**

```text
[into the group]
I keep every file this group shares.
To get a file back, reply conatus to the post with it - I will send it back.

Poll: /vote Question? | Option 1 | Option 2
People vote with reactions. Delete your post and the poll is gone.
```

## Files

Every file posted in the group is downloaded silently - the caption plays no part. A file comes back on the trigger word: as a reply to the post with it, or as a bare word right under it.

**lena posts report.pdf** - the bot keeps the file and says nothing

```text
(the bot says nothing)
```

**`conatus` as a reply to the post with report.pdf**

```text
[the bot sends the file report.pdf as a reply]
```

**`Conatus!` - case and punctuation do not matter**

```text
[the bot sends the file report.pdf as a reply]
```

**`conatus` as a message right under the file** - no reply link (that is how the apps send comments) - the latest posted file is meant

```text
[the bot sends the file report.pdf as a reply]
```

**`conatus` as a reply to a post without a file**

```text
[as a reply]
There is no file in that post.
```

**`conatus` with no file anywhere near** - neither a reply nor a file among the last 20 messages

```text
[as a reply]
Which file? Reply conatus to the post with the file.
```

**`conatus` on a file that is still downloading**

```text
[as a reply]
lecture.mp3 is still downloading - try again in a minute.
```

**`conatus` on a file the bot does not have** - the download failed, or the file has left the archive

```text
[as a reply]
old.pdf was not kept: the download failed or the file is already gone.
```

**`conatus` as a reply to a post older than the bot's history** - the bot never received that post (it joined later) and does not guess which file was meant

```text
[as a reply]
That post is older than the history I have - I do not have its file.
```

**`conatus` as a bare word when the latest file post was deleted** - deleted posts are skipped - the file before it comes back

```text
[the bot sends the file earlier.pdf as a reply]
```

**A file that does not fit the archive** - the only thing the bot says of its own accord while keeping files

```text
[as a reply]
File not kept: the archive is full.
```

**A post with a file is deleted for everyone** - the bot moves the file to the deleted folder without a word; it is purged after 30 days

```text
(the bot says nothing)
```

## Polls

One command in the group; the bot answers with one message and edits it as the reactions come in (a burst of reactions makes one edit). A poll lives as long as the author's post and the bot's message.

**`/vote When shall we meet? | Saturday | Sunday`** - also `/poll`, `/v`, and each language's word: `/sondaggio`, `/голосование`, `/голосування`

```text
[as a reply]
When shall we meet?

👍 Saturday
😀 Sunday

Choose one option with a reaction.
```

**sam reacts 👍, lena reacts 😀**

```text
[the bot rewrites its own message]
When shall we meet?

👍 Saturday · 1
😀 Sunday · 1

Choose one option with a reaction.
2 votes
```

**sam moves the reaction to 😀** - an ordinary poll counts the last choice

```text
[the bot rewrites its own message]
When shall we meet?

👍 Saturday · 0
😀 Sunday · 2

Choose one option with a reaction.
2 votes
```

**lena takes the reaction back**

```text
[the bot rewrites its own message]
When shall we meet?

👍 Saturday · 0
😀 Sunday · 1

Choose one option with a reaction.
1 vote
```

**`/v What shall we read? | Part 1 | Part 2 | Part 3 multiple`** - the word `multiple` anywhere in the command lets everyone choose several options

```text
[as a reply]
What shall we read?

👍 Part 1
😀 Part 2
😂 Part 3

You can choose several options with reactions.
```

**sam reacts 👍 and 😂**

```text
[the bot rewrites its own message]
What shall we read?

👍 Part 1 · 1
😀 Part 2 · 0
😂 Part 3 · 1

You can choose several options with reactions.
1 vote
```

**The author deletes their post with the command** - the bot's message goes with it

```text
[the bot deletes its own message]
```

**An owner deletes the bot's message** - the poll is forgotten; there is nothing left to write to

```text
(the bot says nothing)
```

**`/vote When shall we meet`**

```text
[as a reply]
Separate the question and the options with |:
/vote When shall we meet? | Saturday | Sunday
```

**`/vote When? | Saturday`**

```text
[as a reply]
I need a question and at least two options:
/vote When shall we meet? | Saturday | Sunday
```

**`/vote How many? | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8`**

```text
[as a reply]
No more than 7 options.
```

## What the bot leaves alone

The group is a conversation between people. A command starts with `/`; the one bare word is the trigger, and only on its own.

**"Spinoza writes about conatus in the third part.", "vote When? | Sat | Sun", `/unknown`, "help", "conatus est essentia"**

```text
(the bot says nothing)
```

**A file captioned `conatus`** - kept like any other file; the word in a caption asks for nothing

```text
(the bot says nothing)
```

**Commands and `conatus` in the group history the bot receives when it joins** - files from the history are kept, but nothing is answered

```text
(the bot says nothing)
```

**An invitation to a group whose name does not match the `group` setting** - the bot does not join

```text
(the bot says nothing)
```

## The command menu

What the chat apps show in the bot's command menu (`/set bot commands`), one line per language:

```text
en  'Help':/?,'Poll':/'vote <question> | <option 1> | <option 2>'
ru  'Помощь':/?,'Голосование':/'голосование <вопрос> | <вариант 1> | <вариант 2>'
uk  'Довідка':/?,'Голосування':/'голосування <питання> | <варіант 1> | <варіант 2>'
it  'Aiuto':/?,'Sondaggio':/'sondaggio <domanda> | <opzione 1> | <opzione 2>'
```
