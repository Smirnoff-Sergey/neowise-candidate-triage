import { test } from "node:test";
import assert from "node:assert/strict";
import { init, render, viewFor } from "../app.mjs";

// Minimal stand-ins for DOM elements: render() only touches these properties.
function fakeElements() {
  return {
    panel: { dataset: {} },
    message: { textContent: "", hidden: true },
    result: { hidden: true },
    topic: { textContent: "" },
    draft: { value: "" },
  };
}

test("ready answer shows topic and draft", () => {
  const el = fakeElements();
  render(el, viewFor({ status: "ready", topic: "delivery", draft: "Спасибо!" }));
  assert.equal(el.result.hidden, false);
  assert.equal(el.topic.textContent, "Доставка");
  assert.equal(el.draft.value, "Спасибо!");
  assert.equal(el.message.hidden, true);
});

test("manual_review clears the previous draft and explains what to do", () => {
  const el = fakeElements();
  render(el, viewFor({ status: "ready", topic: "pricing", draft: "Старый черновик" }));
  render(el, viewFor({ status: "manual_review", topic: null, draft: null }));
  assert.equal(el.panel.dataset.state, "manual_review");
  assert.equal(el.result.hidden, true);
  assert.equal(el.draft.value, "");
  assert.equal(el.topic.textContent, "");
  assert.match(el.message.textContent, /вручную/);
});

test("network failure or unexpected answer is treated as manual review", () => {
  for (const reply of [null, { status: "server_error" }, { status: "ready", topic: "refund", draft: "x" }]) {
    const el = fakeElements();
    render(el, viewFor({ status: "ready", topic: "other", draft: "Старый" }));
    render(el, viewFor(reply));
    assert.equal(el.draft.value, "", JSON.stringify(reply));
    assert.equal(el.result.hidden, true);
    assert.equal(el.panel.dataset.state, "manual_review");
  }
});

// A tiny fake document to check the wiring: the stale answer must not overwrite the fresh one.
function fakeDocument() {
  const nodes = {
    "#message": { value: "", focus() {} },
    "#panel": { dataset: {} },
    "#notice": { textContent: "", hidden: true },
    "#result": { hidden: true },
    "#topic": { textContent: "" },
    "#draft": { value: "" },
  };
  const button = { disabled: false };
  const form = {
    listener: null,
    addEventListener(_, fn) { this.listener = fn; },
    querySelector: () => button,
    submit() { return this.listener({ preventDefault() {} }); },
  };
  return { nodes, form, querySelector: (s) => (s === "form" ? form : nodes[s]) };
}

test("empty input is rejected on the page without a request", async () => {
  const doc = fakeDocument();
  let calls = 0;
  init(doc, async () => { calls += 1; });
  doc.nodes["#message"].value = "   ";
  await doc.form.submit();
  assert.equal(calls, 0);
  assert.equal(doc.nodes["#panel"].dataset.state, "invalid_input");
});

test("previous draft disappears as soon as a new request starts and after a failure", async () => {
  const doc = fakeDocument();
  const replies = [
    { status: "ready", topic: "delivery", draft: "Черновик 1" },
    { status: "manual_review", topic: null, draft: null },
  ];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let call = 0;
  init(doc, async () => {
    const reply = replies[call++];
    if (call === 2) await gate;
    return { json: async () => reply };
  });

  doc.nodes["#message"].value = "Где доставка?";
  await doc.form.submit();
  assert.equal(doc.nodes["#draft"].value, "Черновик 1");

  const pending = doc.form.submit();
  assert.equal(doc.nodes["#draft"].value, "", "draft is cleared while waiting");
  release();
  await pending;
  assert.equal(doc.nodes["#draft"].value, "");
  assert.equal(doc.nodes["#panel"].dataset.state, "manual_review");
});
