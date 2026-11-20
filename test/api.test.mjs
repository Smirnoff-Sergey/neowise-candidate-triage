import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.mjs";

let server;
let baseUrl;

before(async () => {
  // Real mock model and the real 300 ms deadline; logs are silenced.
  server = await createApp({ log: () => {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function post(body) {
  const response = await fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const MANUAL = { status: "manual_review", topic: null, draft: null };

describe("POST /api/triage — invalid input", () => {
  for (const [name, body] of [
    ["broken JSON", "{text:"],
    ["missing text", {}],
    ["empty text", { text: "" }],
    ["whitespace-only text", { text: "   \n\t" }],
    ["non-string text", { text: 42 }],
    ["null body", "null"],
    ["array body", "[]"],
  ]) {
    test(`${name} -> 400 invalid_input`, async () => {
      assert.deepEqual(await post(body), { status: 400, body: { status: "invalid_input" } });
    });
  }
});

describe("POST /api/triage — model answers", () => {
  test("valid answer -> 200 ready", async () => {
    const { status, body } = await post({ text: "Когда будет доставка заказа?" });
    assert.equal(status, 200);
    assert.equal(body.status, "ready");
    assert.equal(body.topic, "delivery");
    assert.ok(body.draft.trim().length > 0);
  });

  test("pricing topic", async () => {
    const { body } = await post({ text: "Какая стоимость подписки?" });
    assert.equal(body.topic, "pricing");
  });

  for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    test(`${marker} -> 200 manual_review`, async () => {
      assert.deepEqual(await post({ text: `Заявка ${marker}` }), { status: 200, body: MANUAL });
    });
  }

  test("[timeout] -> manual_review within the 300 ms deadline", async () => {
    const started = performance.now();
    const result = await post({ text: "Заявка [timeout]" });
    const elapsed = performance.now() - started;
    assert.deepEqual(result, { status: 200, body: MANUAL });
    // The mock waits 1200 ms; we must give up long before that.
    assert.ok(elapsed < 900, `answered after ${Math.round(elapsed)} ms`);
  });
});

test("model that ignores the abort signal still times out", async () => {
  const hanging = await createApp({ classify: () => new Promise(() => {}), timeoutMs: 50, log: () => {} });
  await new Promise((resolve) => hanging.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${hanging.address().port}/api/triage`, {
      method: "POST",
      body: JSON.stringify({ text: "Заявка" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), MANUAL);
  } finally {
    await new Promise((resolve) => hanging.close(resolve));
  }
});

test("page and script are served", async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /app\.mjs/);
  const script = await fetch(`${baseUrl}/app.mjs`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);
});
