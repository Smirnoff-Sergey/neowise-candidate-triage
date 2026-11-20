// Page logic. viewFor and render are pure enough to be tested in Node without a browser.

export const TOPIC_LABELS = {
  delivery: "Доставка",
  pricing: "Цены и стоимость",
  other: "Другое",
};

const MESSAGES = {
  loading: "Разбираем заявку…",
  invalid_input: "Введите текст заявки: поле пустое.",
  manual_review:
    "Автоматический разбор не получился. Определите тему и напишите ответ клиенту вручную.",
  unavailable: "Сервис разбора недоступен. Разберите заявку вручную или повторите позже.",
};

/** Maps an API answer (or a fetch failure) to what the manager sees. */
export function viewFor(reply) {
  if (reply?.status === "ready" && TOPIC_LABELS[reply.topic] && typeof reply.draft === "string" && reply.draft.trim()) {
    return { state: "ready", topic: TOPIC_LABELS[reply.topic], draft: reply.draft, message: "" };
  }
  if (reply?.status === "invalid_input") {
    return { state: "invalid_input", topic: "", draft: "", message: MESSAGES.invalid_input };
  }
  if (reply?.status === "loading") {
    return { state: "loading", topic: "", draft: "", message: MESSAGES.loading };
  }
  if (reply?.status === "manual_review") {
    return { state: "manual_review", topic: "", draft: "", message: MESSAGES.manual_review };
  }
  // Network error, 5xx or an answer of unexpected shape: never show a stale or broken draft.
  return { state: "manual_review", topic: "", draft: "", message: MESSAGES.unavailable };
}

/** Applies a view to page elements: {panel, topic, draft, message, result}. */
export function render(el, view) {
  el.panel.dataset.state = view.state;
  el.message.textContent = view.message;
  el.message.hidden = view.message === "";
  el.topic.textContent = view.topic;
  el.draft.value = view.draft;
  el.result.hidden = view.state !== "ready";
}

/** Wires the form. Only the answer to the latest request is shown. */
export function init(doc, fetchFn = fetch) {
  const form = doc.querySelector("form");
  const input = doc.querySelector("#message");
  const button = form.querySelector("button[type=submit]");
  const el = {
    panel: doc.querySelector("#panel"),
    message: doc.querySelector("#notice"),
    result: doc.querySelector("#result"),
    topic: doc.querySelector("#topic"),
    draft: doc.querySelector("#draft"),
  };
  let latest = 0;
  let inFlight = null;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (input.value.trim() === "") {
      render(el, viewFor({ status: "invalid_input" }));
      input.focus();
      return;
    }
    const id = ++latest;
    inFlight?.abort();
    inFlight = new AbortController();
    render(el, viewFor({ status: "loading" }));
    button.disabled = true;

    let reply = null;
    try {
      const response = await fetchFn("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.value }),
        signal: inFlight.signal,
      });
      reply = await response.json();
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
    if (id !== latest) return;
    render(el, viewFor(reply));
    button.disabled = false;
  });
}

if (typeof document !== "undefined") init(document);
