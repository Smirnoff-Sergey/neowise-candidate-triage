import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify as mockClassify } from "./mock-ai.mjs";
import { INVALID_INPUT, MAX_TEXT_LENGTH, MODEL_TIMEOUT_MS, parseInput, triage } from "./triage.mjs";

// A UTF-8 character takes up to 4 bytes, plus room for the JSON wrapper.
const MAX_BODY_BYTES = MAX_TEXT_LENGTH * 4 + 1024;

const staticFiles = {
  "/": { file: "./index.html", type: "text/html; charset=utf-8" },
  "/app.mjs": { file: "./app.mjs", type: "text/javascript; charset=utf-8" },
};

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

/** Reads the body; returns null when it exceeds the size limit. */
async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Builds the HTTP server; the model and the deadline are injectable for tests. */
export async function createApp({ classify = mockClassify, timeoutMs = MODEL_TIMEOUT_MS, log } = {}) {
  const files = {};
  for (const [path, { file, type }] of Object.entries(staticFiles)) {
    files[path] = { body: await readFile(new URL(file, import.meta.url)), type };
  }

  return createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url, "http://localhost");
      const file = files[pathname];
      if (request.method === "GET" && file) {
        response.writeHead(200, { "Content-Type": file.type });
        response.end(file.body);
        return;
      }
      if (request.method !== "POST" || pathname !== "/api/triage") {
        return json(response, 404, { status: "not_found" });
      }
      const raw = await readBody(request);
      const text = raw === null ? null : parseInput(raw);
      if (text === null) return json(response, 400, INVALID_INPUT);
      return json(response, 200, await triage(text, { classify, timeoutMs, log }));
    } catch {
      if (!response.headersSent) json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  const server = await createApp();
  server.listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));
}
