/**
 * English - the default language and the template for every other one.
 *
 * A language file is plain data: no imports, no logic, only the strings the bot
 * sends. To add a language, copy this file, translate the values, and add one
 * import line to languages.js. Keep every key; a test compares the key sets.
 *
 * Placeholders in braces are filled in by i18n/index.js:
 *   {trigger}  the configured word that asks for a file ("conatus" by default)
 *   {name}     a file name
 *   {max}      the largest number of poll options
 */
export default {
  name: "English",

  // How the count of votes is spelled. "simple" picks votes[0] for 1 and votes[1]
  // for everything else; "slavic" picks votes[0]/votes[1]/votes[2] (1 / 2-4 / 5+).
  pluralRule: "simple",
  votes: ["vote", "votes"],

  // Words that work as commands after a slash, in ANY served group: a member may
  // type the command in their own language. "/?" and "/??" always mean help.
  commandWords: {help: ["help"], poll: ["vote", "poll", "v"]},

  // The poll command as this language's texts spell it, and the labels of the
  // command menu the chat apps show for the bot.
  pollCommand: "vote",
  menuHelp: "Help",
  menuPoll: "Poll",
  menuPollArgs: "<question> | <option 1> | <option 2>",

  // The one help: "/?" in the group, any private message, the greeting when the bot joins.
  help: [
    "I keep every file this group shares.",
    "To get a file back, reply {trigger} to the post with it - I will send it back.",
    "",
    "Poll: /vote Question? | Option 1 | Option 2",
    "People vote with reactions. Delete your post and the poll is gone.",
  ].join("\n"),

  // ---- files ----
  noFileInPost: "There is no file in that post.",
  whichFile: "Which file? Reply {trigger} to the post with the file.",
  unknownPost: "That post is older than the history I have - I do not have its file.",
  stillDownloading: "{name} is still downloading - try again in a minute.",
  notKept: "{name} was not kept: the download failed or the file is already gone.",
  archiveFull: "File not kept: the archive is full.",

  // ---- polls ----
  pollNoSeparator: "Separate the question and the options with |:\n/vote When shall we meet? | Saturday | Sunday",
  pollFewOptions: "I need a question and at least two options:\n/vote When shall we meet? | Saturday | Sunday",
  pollTooManyOptions: "No more than {max} options.",
  pollPickOne: "Choose one option with a reaction.",
  pollPickMany: "You can choose several options with reactions.",
}
