import { test } from "node:test";
import assert from "node:assert/strict";
import { credentialEmail, providerStates } from "../src/account.ts";

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

test("S38 credentialEmail reads an email field or the email claim of the token, and nothing else", () => {
  assert.equal(credentialEmail({ type: "oauth", email: "a@b.co" }), "a@b.co");
  assert.equal(credentialEmail({ type: "oauth", access: jwt({ email: "c@d.co" }) }), "c@d.co");
  assert.equal(credentialEmail({ type: "oauth", access: jwt({ "https://api.openai.com/profile": { email: "e@f.co" } }) }), "e@f.co");
  assert.equal(credentialEmail({ type: "oauth", access: "opaque-token", accountId: "X" }), undefined);
  assert.equal(credentialEmail({ type: "oauth", access: jwt({ email: "not an email" }) }), undefined);
  assert.equal(credentialEmail(null), undefined);
});

test("S38 providerStates shows a provider's email only when email display is on", () => {
  const auth = { "openai-codex": { type: "oauth", access: jwt({ email: "c@d.co" }) } };
  assert.equal(providerStates(null, auth, { showEmail: true }).find((p) => p.provider === "openai-codex")?.email, "c@d.co");
  assert.equal(providerStates(null, auth, { showEmail: false }).find((p) => p.provider === "openai-codex")?.email, undefined);
  assert.equal(providerStates(null, auth).find((p) => p.provider === "openai-codex")?.email, undefined);
});
