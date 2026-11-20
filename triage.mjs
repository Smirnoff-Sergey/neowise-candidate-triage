// Request validation and the check of the model answer.
// The model is not trusted: HTTP-level success does not mean a usable result.

export const TOPICS = new Set(["delivery", "pricing", "other"]);
export const MODEL_TIMEOUT_MS = 300;
export const MAX_TEXT_LENGTH = 10_000;

export const MANUAL_REVIEW = Object.freeze({ status: "manual_review", topic: null, draft: null });
export const INVALID_INPUT = Object.freeze({ status: "invalid_input" });

export class TimeoutError extends Error {
  constructor(ms) {
    super(`Model did not answer in ${ms} ms`);
    this.name = "TimeoutError";
  }
}

/** Returns the request text or null when the body is not {"text": "<non-blank string>"}. */
export function parseInput(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const { text } = body;
  if (typeof text !== "string" || text.trim() === "" || text.length > MAX_TEXT_LENGTH) return null;
  return text;
}

/** Checks the raw model output. Returns {topic, draft} or throws with the reason. */
export function parseModelOutput(raw) {
  if (typeof raw !== "string") throw new Error("model output is not a string");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("model output is not JSON");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("model output is not an object");
  }
  if (!TOPICS.has(data.topic)) throw new Error("unknown topic");
  if (typeof data.draft !== "string" || data.draft.trim() === "") throw new Error("empty draft");
  return { topic: data.topic, draft: data.draft.trim() };
}

/** Calls the model with a deadline; the race also covers a model that ignores the signal. */
export async function withTimeout(call, ms) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([call(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classifies the request. Any model failure turns into manual_review:
 * the manager gets the request back for manual handling instead of a broken draft.
 */
export async function triage(text, { classify, timeoutMs = MODEL_TIMEOUT_MS, log = console.warn }) {
  try {
    const raw = await withTimeout((signal) => classify(text, { signal }), timeoutMs);
    return { status: "ready", ...parseModelOutput(raw) };
  } catch (error) {
    // The request text is not logged: it may contain personal data.
    log(JSON.stringify({ event: "triage_manual_review", reason: error?.message ?? String(error) }));
    return { ...MANUAL_REVIEW };
  }
}
