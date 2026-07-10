import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import OpenAI from "openai";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const apiKey = cleanText(process.env.OPENAI_API_KEY || "");
const hasUsableOpenAIKey =
  apiKey && !["sk-your-key-here", "your_real_key_here", "your-key-here"].includes(apiKey);

// Comma-separated allowlist of origins permitted to call the API cross-origin.
// Empty (default) => same-origin only; no CORS headers are emitted.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Simple in-memory rate limit (per IP). Suitable for a single instance; for
// multi-instance deployments put a shared limiter (e.g. a proxy) in front.
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 60);
const chatRateLimitMax = Number(process.env.CHAT_RATE_LIMIT_MAX || 20);

const dataDir = process.env.DATA_DIR
  ? path.resolve(__dirname, process.env.DATA_DIR)
  : path.join(__dirname, "data");
const configPath = path.join(__dirname, "config", "business.json");
const messageStorePath = path.join(dataDir, "messages.json");
const leadStorePath = path.join(dataDir, "leads.json");
let writeQueue = Promise.resolve();

const openai = hasUsableOpenAIKey ? new OpenAI({ apiKey }) : null;
const adminToken = cleanText(process.env.ADMIN_TOKEN || "");

function requireAdminToken(req, res, next) {
  if (!adminToken) return next();
  const bearer = req.headers.authorization?.replace("Bearer ", "");
  const query = cleanText(req.query.token || "");
  if (bearer === adminToken || query === adminToken) return next();
  res.status(401).json({ error: "Unauthorized. Set Authorization: Bearer <ADMIN_TOKEN>." });
}

// --- Startup environment validation ---
// Admin routes expose customer PII (names, emails, phones) and lead mutation.
// In production they MUST be protected — refuse to start without ADMIN_TOKEN.
function validateEnvironment() {
  const errors = [];
  if (isProduction && !adminToken) {
    errors.push(
      "ADMIN_TOKEN is required in production: /api/admin/* exposes customer PII and would otherwise be public."
    );
  }
  if (isProduction && adminToken && adminToken.length < 16) {
    errors.push("ADMIN_TOKEN is too short for production (use >= 16 random characters).");
  }
  if (errors.length) {
    console.error("Environment validation failed:\n- " + errors.join("\n- "));
    process.exit(1);
  }
  if (!hasUsableOpenAIKey) {
    console.warn("No usable OPENAI_API_KEY set — running in local-demo mode (scripted replies).");
  }
  if (!isProduction && !adminToken) {
    console.warn("ADMIN_TOKEN not set — /api/admin/* is OPEN. Fine for local dev only.");
  }
}
validateEnvironment();

// Trust the platform proxy (Railway/Render/Fly/Nginx) so req.ip is the real
// client IP for rate limiting and not the proxy's address.
if (isProduction || process.env.TRUST_PROXY) {
  app.set("trust proxy", 1);
}

// Minimal security headers (no external dependency).
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  next();
});

// CORS: only when an allowlist is configured; otherwise same-origin only.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    return res.sendStatus(origin && allowedOrigins.includes(origin) ? 204 : 403);
  }
  next();
});

// Fixed-window in-memory rate limiter keyed by IP + bucket name.
const rateBuckets = new Map();
function rateLimit(name, max) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${req.ip}`;
    const entry = rateBuckets.get(key);
    if (!entry || now > entry.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }
    next();
  };
}
// Periodically drop stale buckets so the map cannot grow unbounded.
const rateCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateBuckets) {
    if (now > entry.resetAt) rateBuckets.delete(key);
  }
}, rateLimitWindowMs).unref();

app.use(express.json({ limit: "1mb" }));
app.use("/api", rateLimit("api", rateLimitMax));
app.use(express.static(path.join(__dirname, "public")));

async function ensureJsonFile(filePath, defaultValue) {
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    await writeFile(filePath, `${JSON.stringify(defaultValue, null, 2)}\n`, "utf8");
  }
}

async function readJson(filePath, defaultValue) {
  await ensureJsonFile(filePath, defaultValue);
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw || JSON.stringify(defaultValue));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function updateJsonArray(filePath, updater) {
  let result;

  writeQueue = writeQueue.then(async () => {
    const items = await readJson(filePath, []);
    result = await updater(items);
    await writeJson(filePath, items);
  });

  await writeQueue;
  return result;
}

async function getBusinessConfig() {
  const config = await readJson(configPath, {});
  return {
    businessName: "Nova Commerce",
    businessDescription:
      "An online store selling practical tech accessories, lifestyle products, and giftable everyday essentials.",
    industry: "e-commerce",
    toneOfVoice: "professional, friendly, concise, and sales-focused without being pushy",
    ...config,
  };
}

function cleanText(value, maxLength = 4000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

function formatList(items, formatter) {
  return arrayFrom(items).map(formatter).filter(Boolean).join("\n");
}

function formatContact(contact = {}) {
  return [
    contact.email ? `Email: ${contact.email}` : "",
    contact.phone ? `Phone: ${contact.phone}` : "",
    contact.website ? `Website: ${contact.website}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSystemPrompt(config) {
  const products = formatList(
    config.products,
    (product) =>
      `- ${product.name}: ${product.price || "price not configured"}${product.description ? ` - ${product.description}` : ""}${
        product.status ? ` (${product.status})` : ""
      }`
  );
  const policies = formatList(config.policies, (policy) => `- ${policy.name}: ${policy.details}`);
  const faqs = formatList(config.faqs, (faq) => `- Q: ${faq.question}\n  A: ${faq.answer}`);

  return [
    `You are the AI receptionist and product support assistant for ${config.businessName}.`,
    `Business description: ${config.businessDescription}`,
    `Tone of voice: ${config.toneOfVoice}`,
    `Opening hours: ${config.openingHours || "not configured"}`,
    `Location: ${config.location || "online only or not configured"}`,
    `Contact info:\n${formatContact(config.contact) || "not configured"}`,
    `Products/services:\n${products || "No products configured."}`,
    `Policies:\n${policies || "No policies configured."}`,
    `FAQs:\n${faqs || "No FAQs configured."}`,
    "Rules:",
    "- Keep replies short, professional, and helpful.",
    "- Answer product, shipping, return, sizing, payment, and order questions using only the configured business information.",
    "- Never invent prices, discounts, products, stock, shipping times, or order status.",
    "- If information is missing, say you can take the request and the team will confirm it.",
    "- If the customer wants to buy, reserve, check availability, track an order, or needs a quote, collect name, email or phone, what they need, order number if relevant, preferred delivery date/time if relevant, and notes.",
    "- If a real inventory, payment, order, or calendar system is not connected, mark requests as pending confirmation.",
    "- Do not spam or pressure the customer.",
    "- Ask one clear follow-up question at a time.",
  ].join("\n");
}

function toChatCompletionMessage(message) {
  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
  };
}

function firstMatch(text, regex) {
  const match = text.match(regex);
  return match?.[1]?.trim() || "";
}

function extractName(text) {
  const name =
    firstMatch(text, /\b(?:my name is|name is|i am|i'm|this is)\s+([a-z][a-z .'-]{1,48})/i) ||
    firstMatch(text, /\bname:\s*([a-z][a-z .'-]{1,48})/i);

  return name
    .replace(/\s+(and|my|email|phone|number|i|want|need)\b.*$/i, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim();
}

function extractPreferredDateTime(text) {
  const relative = text.match(
    /\b(today|tomorrow|tonight|next week|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  );
  const date = text.match(/\b(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{1,2}-\d{1,2})\b/);
  const time = text.match(
    /\b(?:(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:am|pm)?|(?:[1-9]|1[0-2])\s*(?:am|pm))\b/i
  );

  return [relative?.[0], date?.[0], time?.[0]].filter(Boolean).join(" ").trim();
}

function findProductInterest(text, config) {
  const lowerText = text.toLowerCase();
  return arrayFrom(config.products)
    .filter((product) => product.name && lowerText.includes(product.name.toLowerCase()))
    .map((product) => product.name);
}

function extractLeadCandidate(text, config) {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const phone = text.match(/(?:\+?\d[\d ().-]{6,}\d)/)?.[0]?.trim() || "";
  const name = extractName(text);
  const productInterest = findProductInterest(text, config);
  const preferredDateTime = extractPreferredDateTime(text);
  const orderNumber =
    text.match(
      /\b(?:order|ord|invoice|tracking)\s*(?:number|no\.?|id|#)\s*([a-z0-9-]{4,})\b/i
    )?.[1] || "";
  const buyingIntent =
    /\b(buy|purchase|order|checkout|reserve|interested|need|want|looking for|quote|invoice|available|in stock|delivery|ship|track|return|exchange)\b/i.test(
      text
    );
  const hasDetails = Boolean(email || phone || name || productInterest.length || orderNumber);
  const shouldCreate = buyingIntent || Boolean(email || phone);

  if (!shouldCreate) {
    return null;
  }

  const requestType = orderNumber
    ? "order support"
    : productInterest.length
      ? "product/order lead"
      : buyingIntent
        ? "sales inquiry"
        : "customer inquiry";

  return {
    customerName: name,
    email,
    phone,
    requestType,
    productInterest,
    orderNumber,
    preferredDateTime,
    need: productInterest.length
      ? `Interested in ${productInterest.join(", ")}`
      : cleanText(text, 240),
    notes: cleanText(text, 800),
    hasDetails,
  };
}

async function upsertLeadFromMessage(sessionId, message, config) {
  const extracted = extractLeadCandidate(message, config);

  if (!extracted) {
    return null;
  }

  return updateJsonArray(leadStorePath, (leads) => {
    const now = new Date().toISOString();
    let lead = leads.find((item) => item.sessionId === sessionId && item.status !== "completed");

    if (!lead) {
      lead = {
        id: crypto.randomUUID(),
        sessionId,
        customerName: "",
        email: "",
        phone: "",
        requestType: "customer inquiry",
        productInterest: [],
        orderNumber: "",
        preferredDateTime: "",
        need: "",
        notes: "",
        status: "new",
        createdAt: now,
        updatedAt: now,
      };
      leads.push(lead);
    }

    lead.customerName = extracted.customerName || lead.customerName;
    lead.email = extracted.email || lead.email;
    lead.phone = extracted.phone || lead.phone;
    lead.requestType = extracted.requestType || lead.requestType;
    lead.productInterest = Array.from(
      new Set([...(lead.productInterest || []), ...extracted.productInterest])
    );
    lead.orderNumber = extracted.orderNumber || lead.orderNumber;
    lead.preferredDateTime = extracted.preferredDateTime || lead.preferredDateTime;
    lead.need = extracted.need || lead.need;
    lead.notes = [lead.notes, extracted.notes].filter(Boolean).join("\n---\n").slice(-2000);
    lead.updatedAt = now;

    return lead;
  });
}

async function appendMessages(newMessages) {
  return updateJsonArray(messageStorePath, (messages) => {
    messages.push(...newMessages);
    return newMessages;
  });
}

function generateLocalFallbackReply(message, config, lead) {
  const productNames = findProductInterest(message, config);

  if (lead && (!lead.email || !lead.phone) && !lead.customerName) {
    return "I can help with that. Please send your name and email or phone, and the team will confirm the order details.";
  }

  if (lead && !lead.email && !lead.phone) {
    return "Got it. What email or phone number should the team use to confirm this request?";
  }

  if (lead) {
    return "Thanks. I saved this as a pending request for the store team to review and confirm.";
  }

  if (productNames.length) {
    return `I can help with ${productNames.join(", ")}. What would you like to know: price, shipping, availability, or order help?`;
  }

  return `Thanks for reaching out to ${config.businessName}. What product or order can I help with today?`;
}

function getContactFromLead(lead) {
  const safeLead = lead || {};
  return [safeLead.email, safeLead.phone].filter(Boolean).join(" / ");
}

function buildConversations(messages, leads) {
  const leadBySession = new Map(leads.map((lead) => [lead.sessionId, lead]));
  const grouped = new Map();

  for (const message of messages) {
    const existing = grouped.get(message.sessionId) || {
      sessionId: message.sessionId,
      firstMessageAt: message.createdAt,
      lastMessageAt: message.createdAt,
      messageCount: 0,
      latestMessage: "",
      lead: leadBySession.get(message.sessionId) || null,
    };

    existing.messageCount += 1;
    existing.lastMessageAt = message.createdAt;
    existing.latestMessage = message.content;
    grouped.set(message.sessionId, existing);
  }

  return Array.from(grouped.values())
    .map((conversation) => ({
      ...conversation,
      customerName: conversation.lead?.customerName || "Unknown",
      contactInfo: getContactFromLead(conversation.lead) || "Not collected",
      requestType: conversation.lead?.requestType || "general chat",
      status: conversation.lead?.status || "no lead",
    }))
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
}

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Lightweight liveness probe for platforms (no I/O). Use this for health checks.
app.get(["/health", "/healthz"], (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/health", async (req, res) => {
  const config = await getBusinessConfig();

  res.json({
    ok: true,
    hasOpenAIKey: Boolean(openai),
    mode: openai ? "openai" : "local-demo",
    model,
    businessName: config.businessName,
  });
});

app.get("/api/config", async (req, res) => {
  const config = await getBusinessConfig();
  res.json({ config });
});

app.get("/api/messages", async (req, res) => {
  const sessionId = cleanText(req.query.sessionId);
  const [allMessages, allLeads] = await Promise.all([
    readJson(messageStorePath, []),
    sessionId ? readJson(leadStorePath, []) : Promise.resolve([]),
  ]);
  const filtered = sessionId
    ? allMessages.filter((message) => message.sessionId === sessionId)
    : allMessages.slice(-100);
  const lead = sessionId
    ? allLeads
        .filter((item) => item.sessionId === sessionId && item.status !== "cancelled")
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0] || null
    : null;

  res.json({
    messages: filtered.slice(-50),
    lead,
  });
});

app.post("/api/chat", rateLimit("chat", chatRateLimitMax), async (req, res) => {
  const userMessage = cleanText(req.body?.message);
  const sessionId = cleanText(req.body?.sessionId) || crypto.randomUUID();

  if (!userMessage) {
    return res.status(400).json({ error: "Message is required." });
  }

  const config = await getBusinessConfig();
  const userRecord = {
    id: crypto.randomUUID(),
    sessionId,
    role: "user",
    content: userMessage,
    createdAt: new Date().toISOString(),
  };

  await appendMessages([userRecord]);
  const lead = await upsertLeadFromMessage(sessionId, userMessage, config);

  try {
    const allMessages = await readJson(messageStorePath, []);
    const previousMessages = allMessages
      .filter((message) => message.sessionId === sessionId)
      .slice(-12)
      .map(toChatCompletionMessage);

    let reply;

    if (openai) {
      const completion = await openai.chat.completions.create({
        model,
        temperature: 0.35,
        messages: [{ role: "system", content: buildSystemPrompt(config) }, ...previousMessages],
      });

      reply =
        completion.choices?.[0]?.message?.content?.trim() ||
        "I could not generate a response. Please try asking that another way.";
    } else {
      reply = generateLocalFallbackReply(userMessage, config, lead);
    }

    const assistantRecord = {
      id: crypto.randomUUID(),
      sessionId,
      role: "assistant",
      content: reply,
      createdAt: new Date().toISOString(),
    };

    await appendMessages([assistantRecord]);

    res.json({
      reply,
      sessionId,
      model,
      mode: openai ? "openai" : "local-demo",
      leadCaptured: Boolean(lead),
      lead,
    });
  } catch (error) {
    console.error("Chat request failed:", error);
    res.status(500).json({
      error: "The chat request failed. Check your API key, model name, and terminal logs.",
    });
  }
});

app.get("/api/admin/summary", requireAdminToken, async (req, res) => {
  const [messages, leads, config] = await Promise.all([
    readJson(messageStorePath, []),
    readJson(leadStorePath, []),
    getBusinessConfig(),
  ]);
  const conversations = buildConversations(messages, leads);

  res.json({
    businessName: config.businessName,
    stats: {
      conversations: conversations.length,
      leads: leads.length,
      newLeads: leads.filter((lead) => lead.status === "new").length,
      completedLeads: leads.filter((lead) => lead.status === "completed").length,
    },
    conversations,
    leads: leads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
  });
});

app.get("/api/admin/leads", requireAdminToken, async (req, res) => {
  const leads = await readJson(leadStorePath, []);
  res.json({ leads: leads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) });
});

app.patch("/api/admin/leads/:id", requireAdminToken, async (req, res) => {
  const allowedStatuses = new Set(["new", "contacted", "completed", "cancelled"]);
  const status = cleanText(req.body?.status, 40);

  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "Invalid lead status." });
  }

  const updatedLead = await updateJsonArray(leadStorePath, (leads) => {
    const lead = leads.find((item) => item.id === req.params.id);

    if (!lead) {
      return null;
    }

    lead.status = status;
    lead.updatedAt = new Date().toISOString();
    return lead;
  });

  if (!updatedLead) {
    return res.status(404).json({ error: "Lead not found." });
  }

  res.json({ lead: updatedLead });
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found." });
});

app.use((req, res) => {
  res.status(404).send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Page Not Found</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <main class="not-found-shell">
          <section class="not-found-card" aria-label="Page not found">
            <p class="eyebrow">404</p>
            <h1>Page not found</h1>
            <p>The page you requested does not exist.</p>
            <a class="admin-link" href="/">Return to chat</a>
          </section>
        </main>
      </body>
    </html>
  `);
});

app.use((error, req, res, next) => {
  console.error("Unhandled request failed:", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(error.status || 500).json({
    error: error.status === 400 ? "Invalid request body." : "Server error. Please try again.",
  });
});

const server = app.listen(port, host, () => {
  console.log(
    `AI automation messages bot running on http://${host}:${port} (mode: ${openai ? "openai" : "local-demo"})`
  );
});

// Graceful shutdown: stop accepting connections, finish in-flight requests.
function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully...`);
  clearInterval(rateCleanup);
  server.close(() => {
    console.log("HTTP server closed. Bye.");
    process.exit(0);
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
