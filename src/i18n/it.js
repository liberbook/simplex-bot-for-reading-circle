/** Italiano. Le chiavi sono quelle di en.js (un test lo verifica). */
export default {
  name: "Italiano",

  pluralRule: "simple",
  votes: ["voto", "voti"],

  commandWords: {help: ["aiuto"], poll: ["sondaggio", "s"]},

  pollCommand: "sondaggio",
  menuHelp: "Aiuto",
  menuPoll: "Sondaggio",
  menuPollArgs: "<domanda> | <opzione 1> | <opzione 2>",

  help: [
    "Conservo tutti i file di questo gruppo.",
    "Per riavere un file, rispondi {trigger} al messaggio che lo contiene - te lo rimando.",
    "",
    "Sondaggio: /sondaggio Domanda? | Opzione 1 | Opzione 2",
    "Si vota con le reazioni. Cancella il tuo messaggio e il sondaggio sparisce.",
  ].join("\n"),

  // ---- file ----
  noFileInPost: "In quel messaggio non c'è nessun file.",
  whichFile: "Quale file? Rispondi {trigger} al messaggio con il file.",
  unknownPost: "Quel messaggio è più vecchio della cronologia che ho - non ho il suo file.",
  stillDownloading: "{name} è ancora in scaricamento - riprova tra un minuto.",
  notKept: "{name} non è stato conservato: lo scaricamento è fallito o il file non c'è più.",
  archiveFull: "File non conservato: l'archivio è pieno.",

  // ---- sondaggi ----
  pollNoSeparator: "Separa la domanda e le opzioni con |:\n/sondaggio Quando ci vediamo? | Sabato | Domenica",
  pollFewOptions: "Servono una domanda e almeno due opzioni:\n/sondaggio Quando ci vediamo? | Sabato | Domenica",
  pollTooManyOptions: "Non più di {max} opzioni.",
  pollPickOne: "Scegli un'opzione con una reazione.",
  pollPickMany: "Puoi scegliere più opzioni con le reazioni.",
}
