import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const serverPath = path.join(repoRoot, "server.js");
const dataDir = path.join(repoRoot, ".tmp", "session-auth-data");
const port = 3212;
const base = `http://127.0.0.1:${port}`;

let child;
let conversationA;
let conversationB;

async function waitForHealth(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Server did not become healthy in time.");
}

async function startConversation(message, suppliedSessionId) {
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId: suppliedSessionId }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  return body;
}

before(async () => {
  await rm(dataDir, { recursive: true, force: true });
  child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      HOST: "127.0.0.1",
      ADMIN_TOKEN: "test-admin-token-0123456789",
      DATA_DIR: ".tmp/session-auth-data",
      OPENAI_API_KEY: "",
      RATE_LIMIT_MAX: "1000",
      CHAT_RATE_LIMIT_MAX: "1000",
    },
    stdio: "ignore",
  });
  await waitForHealth();

  conversationA = await startConversation(
    "My name is Alice Example. I want Aurora Wireless Earbuds. Email alice@example.com.",
    "attacker-selected-session"
  );
  conversationB = await startConversation(
    "Please help with an existing order. Unique conversation B marker.",
    conversationA.sessionId
  );
});

after(() => {
  child?.kill("SIGTERM");
});

test("the server issues its own high-entropy session identity", () => {
  assert.notEqual(conversationA.sessionId, "attacker-selected-session");
  assert.notEqual(conversationB.sessionId, conversationA.sessionId);
});

test("chat responses never return lead PII", () => {
  assert.equal(conversationA.leadCaptured, true);
  assert.equal(Object.hasOwn(conversationA, "lead"), false);
  assert.equal(Object.hasOwn(conversationA, "email"), false);
  assert.equal(Object.hasOwn(conversationA, "phone"), false);
  assert.equal(Object.hasOwn(conversationA, "customerName"), false);
});

test("message history rejects unauthenticated and invalid credentials", async () => {
  const unauthenticated = await fetch(`${base}/api/messages`);
  assert.equal(unauthenticated.status, 401);

  const legacyQuery = await fetch(
    `${base}/api/messages?sessionId=${encodeURIComponent(conversationA.sessionId)}`
  );
  assert.equal(legacyQuery.status, 401);

  const invalid = await fetch(`${base}/api/messages`, {
    headers: { Authorization: "Bearer definitely-not-a-valid-token" },
  });
  assert.equal(invalid.status, 401);
});

test("a credential returns only its own conversation and no lead object", async () => {
  const response = await fetch(
    `${base}/api/messages?sessionId=${encodeURIComponent(conversationB.sessionId)}`,
    { headers: { Authorization: `Bearer ${conversationA.sessionToken}` } }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const body = await response.json();
  const contents = body.messages.map((message) => message.content).join("\n");
  assert.match(contents, /alice@example\.com/i);
  assert.doesNotMatch(contents, /Unique conversation B marker/i);
  assert.ok(body.messages.every((message) => !Object.hasOwn(message, "sessionId")));
  assert.equal(body.leadCaptured, true);
  assert.equal(Object.hasOwn(body, "lead"), false);
});

test("caller-supplied session IDs cannot redirect an authenticated chat", async () => {
  const marker = "Credential A follow-up marker";
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${conversationA.sessionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: marker, sessionId: conversationB.sessionId }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sessionId, conversationA.sessionId);
  assert.equal(Object.hasOwn(body, "sessionToken"), false);

  const conversationBResponse = await fetch(`${base}/api/messages`, {
    headers: { Authorization: `Bearer ${conversationB.sessionToken}` },
  });
  const conversationBBody = await conversationBResponse.json();
  assert.doesNotMatch(
    conversationBBody.messages.map((message) => message.content).join("\n"),
    new RegExp(marker)
  );
});

test("only a hash of each conversation credential is persisted", async () => {
  const storedSessions = await readFile(path.join(dataDir, "sessions.json"), "utf8");
  assert.doesNotMatch(storedSessions, new RegExp(conversationA.sessionToken));
  assert.doesNotMatch(storedSessions, new RegExp(conversationB.sessionToken));
  assert.match(storedSessions, /"tokenHash": "[a-f0-9]{64}"/);
});

test("Helmet CSP is active and Express does not advertise itself", async () => {
  const response = await fetch(`${base}/`);
  assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(response.headers.get("x-powered-by"), null);
});
