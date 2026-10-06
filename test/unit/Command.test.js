import test from "node:test"
import assert from "node:assert/strict"
import {Kind, groupMatches, isBareWord, parseCommand} from "../../src/domain/Command.js"

test("only a slash or the bare trigger word makes a command; everything else is conversation", () => {
  const kind = (t) => parseCommand(t, "conatus").kind
  assert.equal(kind("/?"), Kind.HELP)
  assert.equal(kind("/??"), Kind.HELP)
  assert.equal(kind("/help"), Kind.HELP)
  assert.deepEqual(parseCommand("/голосование Когда? | Сб | Вс", "conatus"), {kind: Kind.POLL, argument: "Когда? | Сб | Вс"})
  assert.equal(parseCommand("/г А | б | в", "conatus").argument, "А | б | в")
  assert.equal(kind("conatus"), Kind.FETCH)
  assert.equal(kind("Conatus!"), Kind.FETCH)
  assert.equal(kind("  conatus."), Kind.FETCH)
  for (const talk of ["Спиноза писал о conatus как о стремлении", "conatus est", "голосование завтра", "help me", "/список", "/unknown", ""]) assert.equal(kind(talk), Kind.NONE, talk)
})

test("isBareWord and groupMatches", () => {
  assert.equal(isBareWord("SAVE", "save"), true)
  assert.equal(isBareWord("save it", "save"), false)
  assert.equal(groupMatches("*", {name: "x", title: "Anything"}), true)
  assert.equal(groupMatches("Ethics", {name: "ethics_1", title: "Ethics"}), true)
  assert.equal(groupMatches("eth*", {name: "ethics", title: "Ethics"}), true)
  assert.equal(groupMatches("Ethics", {name: "random", title: "Random"}), false)
  assert.equal(groupMatches("a.b", {name: "axb", title: "axb"}), false, "a dot is a dot, not a regex")
})
