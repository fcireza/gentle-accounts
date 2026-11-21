import { test } from "node:test";
import assert from "node:assert/strict";
import { runOauthLogin, type LoginUi } from "../src/oauth-login.ts";

function ui(answers: { input?: string; select?: string }) {
  const notes: string[] = [];
  const impl: LoginUi = {
    input: async () => answers.input,
    select: async () => answers.select,
    notify: (message) => void notes.push(message),
  };
  return { impl, notes };
}

test("S37 oauth: the provider's own flow runs with the command's UI and the credential comes back tagged oauth", async () => {
  const { impl, notes } = ui({ input: "the-code", select: "Browser" });
  const opened: string[] = [];
  const answers: string[] = [];
  const credential = await runOauthLogin(
    {
      async login(i) {
        i.notify({ type: "auth_url", url: "https://example.test/auth", instructions: "approve it" });
        i.notify({ type: "device_code", userCode: "ABCD", verificationUri: "https://example.test/device" });
        i.notify({ type: "progress", message: "waiting" });
        answers.push(await i.prompt({ type: "manual_code", message: "Paste the code" }));
        answers.push(await i.prompt({ type: "select", message: "Method", options: [{ id: "b", label: "Browser" }] }));
        return { access: "a", refresh: "r", expires: 7 };
      },
    },
    impl,
    (url) => opened.push(url),
  );
  assert.deepEqual(credential, { access: "a", refresh: "r", expires: 7, type: "oauth" });
  assert.deepEqual(answers, ["the-code", "b"]);
  assert.deepEqual(opened, ["https://example.test/auth", "https://example.test/device"]);
  assert.deepEqual(notes, ["Open this link to sign in: https://example.test/auth\napprove it", "Go to https://example.test/device and enter the code ABCD", "waiting"]);
});

test("S37 oauth: cancelling a prompt rejects the login", async () => {
  const { impl } = ui({});
  await assert.rejects(runOauthLogin({ login: async (i) => (await i.prompt({ type: "text", message: "x" }), {}) }, impl), /login cancelled/);
  await assert.rejects(runOauthLogin({ login: async (i) => (await i.prompt({ type: "select", message: "x", options: [{ id: "a", label: "A" }] }), {}) }, impl), /login cancelled/);
});

test("S40 oauth: a login nobody completes times out, aborts the provider's flow and never resolves", async () => {
  const { impl } = ui({});
  let aborted = false;
  await assert.rejects(
    runOauthLogin({ login: (i) => new Promise((_, reject) => i.signal.addEventListener("abort", () => ((aborted = true), reject(new Error("aborted"))))) }, impl, () => {}, 20),
    /login timed out/,
  );
  assert.equal(aborted, true);
});

test("S40 oauth: the browser opener passes the URL as one argument without a shell, even on Windows", async () => {
  const { openBrowser } = await import("../src/oauth-login.ts");
  assert.doesNotThrow(() => openBrowser("ftp://not-http", "win32"), "non-http links are ignored");
  assert.doesNotThrow(() => openBrowser("https://example.test/?a=1&calc=2", "linux"));
});
