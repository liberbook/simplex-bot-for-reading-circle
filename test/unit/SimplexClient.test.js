import test from "node:test"
import assert from "node:assert/strict"
import {SimplexClient} from "../../src/transport/SimplexClient.js"

/** Records command strings and answers each with the next scripted response. */
class ScriptedConnection {
  constructor(responses) {
    this.responses = responses
    this.sent = []
  }
  async send(cmd) {
    this.sent.push(cmd)
    return this.responses.shift()
  }
}

async function clientWith(responses) {
  const connection = new ScriptedConnection([{type: "activeUser", user: {userId: 4, profile: {displayName: "spinoza"}}}, ...responses])
  const client = new SimplexClient(connection)
  await client.activeUser()
  connection.sent = []
  return {client, sent: connection.sent}
}

// command syntax as documented in simplex-chat bots/api/COMMANDS.md
test("an existing address keeps its auto-reply and gets auto-accept via the API commands", async () => {
  const autoReply = {type: "text", text: "hi"}
  const {client, sent} = await clientWith([
    {type: "userContactLink", contactLink: {connLinkContact: {connFullLink: "https://full", connShortLink: "https://short"}, addressSettings: {businessAddress: false, autoReply}}},
    {type: "userContactLinkUpdated"},
  ])
  assert.equal(await client.ensureAddress(), "https://short")
  assert.deepEqual(sent, ["/_show_address 4", `/_address_settings 4 ${JSON.stringify({businessAddress: false, autoReply, autoAccept: {acceptIncognito: false}})}`])
})

test("a missing address is created first", async () => {
  const {client, sent} = await clientWith([
    {type: "chatCmdError", chatError: {type: "errorStore", storeError: {type: "userContactLinkNotFound"}}},
    {type: "userContactLinkCreated", connLinkContact: {connFullLink: "https://full"}},
    {type: "userContactLinkUpdated"},
  ])
  assert.equal(await client.ensureAddress(), "https://full")
  assert.deepEqual(sent.slice(0, 2), ["/_show_address 4", "/_address 4"])
})

test("member-contact auto-accept uses the user id", async () => {
  const {client, sent} = await clientWith([{type: "cmdOk"}])
  await client.acceptMemberContacts()
  assert.deepEqual(sent, ["/_set accept member contacts 4 on"])
})

test("a new group link is joined with the prepared link from the connection plan", async () => {
  const {client, sent} = await clientWith([
    {type: "connectionPlan", connLink: {connFullLink: "simplex:/full", connShortLink: "https://simplex.chat/g#x"}, connectionPlan: {type: "groupLink", groupLinkPlan: {type: "ok", groupSLinkData_: {groupProfile: {displayName: "Ethics"}}}}},
    {type: "sentInvitation"},
  ])
  assert.deepEqual(await client.joinGroupLink("https://simplex.chat/g#x"), {status: "connecting", title: "Ethics"})
  assert.deepEqual(sent, ["/_connect plan 4 https://simplex.chat/g#x", "/_connect 4 simplex:/full https://simplex.chat/g#x"])
})
