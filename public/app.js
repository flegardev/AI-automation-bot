const chatForm = document.querySelector("#chatForm");
const messageInput = document.querySelector("#messageInput");
const messagesEl = document.querySelector("#messages");
const sendButton = document.querySelector("#sendButton");
const newChatButton = document.querySelector("#newChatButton");
const composerError = document.querySelector("#composerError");
const statusPill = document.querySelector("#statusPill");
const statusText = document.querySelector("#statusText");
const sessionLabel = document.querySelector("#sessionLabel");
const messageCount = document.querySelector("#messageCount");
const modelName = document.querySelector("#modelName");
const businessName = document.querySelector("#businessName");
const businessDescription = document.querySelector("#businessDescription");
const chatTitle = document.querySelector("#chatTitle");
const productList = document.querySelector("#productList");
const storeMeta = document.querySelector("#storeMeta");
const leadStatus = document.querySelector("#leadStatus");
const quickActionButtons = document.querySelectorAll("[data-prompt]");

const sessionKey = "ai-commerce-session-id";
let sessionId = localStorage.getItem(sessionKey) || crypto.randomUUID();
let messages = [];
let isSending = false;
let isTyping = false;
let leadCaptured = false;

localStorage.setItem(sessionKey, sessionId);

function shortSession(id) {
  return id ? id.slice(0, 8) : "New";
}

function updateStats(model = modelName.textContent) {
  sessionLabel.textContent = shortSession(sessionId);
  messageCount.textContent = String(messages.length);
  modelName.textContent = model || "-";
}

function setStatus(text, ready = false) {
  statusText.textContent = text;
  statusPill.classList.toggle("ready", ready);
}

function setComposerError(message = "") {
  composerError.textContent = message;
  composerError.hidden = !message;
  messageInput.setAttribute("aria-invalid", message ? "true" : "false");
}

function setSendingState(sending) {
  isSending = sending;
  isTyping = sending;
  sendButton.disabled = sending;
  newChatButton.disabled = sending;
  messageInput.disabled = sending;
  sendButton.textContent = sending ? "Sending" : "Send";

  for (const button of quickActionButtons) {
    button.disabled = sending;
  }
}

function renderProducts(products = []) {
  productList.innerHTML = "";

  if (products.length === 0) {
    const item = document.createElement("article");
    item.className = "product-item";
    item.textContent = "No featured products configured yet.";
    productList.append(item);
    return;
  }

  for (const product of products.slice(0, 4)) {
    const item = document.createElement("article");
    item.className = "product-item";

    const name = document.createElement("strong");
    name.textContent = product.name;

    const details = document.createElement("span");
    details.textContent = [product.price || "Price pending", product.status]
      .filter(Boolean)
      .join(" / ");

    const description = document.createElement("small");
    description.textContent = product.description || "Product detail pending.";

    item.append(name, details, description);
    productList.append(item);
  }
}

function renderStoreMeta(config = {}) {
  storeMeta.innerHTML = "";

  const items = [
    ["Hours", config.openingHours],
    ["Location", config.location],
    ["Email", config.contact?.email],
  ].filter(([, value]) => value);

  for (const [label, value] of items) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    storeMeta.append(term, description);
  }
}

function createMessageBubble(message) {
  const bubble = document.createElement("article");
  bubble.className = `message ${message.role}`;

  const meta = document.createElement("span");
  meta.className = "message-meta";
  meta.textContent =
    message.role === "assistant" ? "Assistant" : message.role === "error" ? "Error" : "Customer";

  const content = document.createElement("div");
  content.textContent = message.content;

  bubble.append(meta, content);
  return bubble;
}

function createTypingBubble() {
  const bubble = document.createElement("article");
  bubble.className = "message assistant typing";
  bubble.setAttribute("aria-label", "Assistant is typing");
  bubble.innerHTML = "<span></span><span></span><span></span>";
  return bubble;
}

function renderMessages() {
  messagesEl.innerHTML = "";

  if (messages.length === 0 && !isTyping) {
    const empty = document.createElement("article");
    empty.className = "empty-state";
    const title = document.createElement("strong");
    title.textContent = "Ready for a customer question";
    const copy = document.createElement("span");
    copy.textContent = "Ask about a product, order, delivery, return, or availability.";
    empty.append(title, copy);
    messagesEl.append(empty);
    updateStats();
    return;
  }

  for (const message of messages) {
    messagesEl.append(createMessageBubble(message));
  }

  if (isTyping) {
    messagesEl.append(createTypingBubble());
  }

  updateStats();
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addLocalMessage(role, content) {
  messages.push({ role, content });
  renderMessages();
}

function addErrorMessage(content) {
  messages.push({ role: "error", content });
  renderMessages();
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const data = await response.json();
  const config = data.config || {};

  businessName.textContent = config.businessName || "Online Store Support";
  chatTitle.textContent = `${config.businessName || "Store"} Assistant`;
  businessDescription.textContent =
    config.businessDescription || "Product questions, order help, and request collection.";
  renderProducts(config.products || []);
  renderStoreMeta(config);
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();

    updateStats(data.model);
    setStatus(data.hasOpenAIKey ? "OpenAI ready" : "Demo mode", true);
  } catch {
    setStatus("Backend offline", false);
  }
}

async function loadSavedMessages() {
  try {
    const response = await fetch(`/api/messages?sessionId=${encodeURIComponent(sessionId)}`);
    const data = await response.json();
    messages = Array.isArray(data.messages)
      ? data.messages.map(({ role, content }) => ({ role, content }))
      : [];
    leadCaptured = Boolean(data.lead);
    leadStatus.textContent = leadCaptured ? "Lead saved" : "No lead yet";
    renderMessages();
  } catch {
    renderMessages();
  }
}

async function sendMessage(message) {
  if (isSending || !message.trim()) {
    return;
  }

  setComposerError();
  setSendingState(true);
  renderMessages();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Something went wrong.");
    }

    sessionId = data.sessionId || sessionId;
    localStorage.setItem(sessionKey, sessionId);
    isTyping = false;
    addLocalMessage("assistant", data.reply);
    updateStats(data.model);
    // A lead persists for the whole session, so keep the indicator sticky once
    // captured — don't downgrade it because a later message had no lead intent.
    leadCaptured = leadCaptured || Boolean(data.leadCaptured);
    leadStatus.textContent = leadCaptured ? "Lead saved" : "No lead yet";
  } catch (error) {
    isTyping = false;
    addErrorMessage(error.message);
  } finally {
    setSendingState(false);
    messageInput.focus();
  }
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();

  if (isSending) {
    return;
  }

  if (!message) {
    setComposerError("Type a message before sending.");
    messageInput.focus();
    return;
  }

  setComposerError();
  messageInput.value = "";
  addLocalMessage("user", message);
  await sendMessage(message);
});

messageInput.addEventListener("keydown", (event) => {
  if (composerError.textContent) {
    setComposerError();
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

newChatButton.addEventListener("click", () => {
  if (isSending) {
    return;
  }

  sessionId = crypto.randomUUID();
  localStorage.setItem(sessionKey, sessionId);
  messages = [];
  leadCaptured = false;
  leadStatus.textContent = "No lead yet";
  setComposerError();
  renderMessages();
  messageInput.focus();
});

for (const button of quickActionButtons) {
  button.addEventListener("click", async () => {
    if (isSending) {
      return;
    }

    const prompt = button.dataset.prompt || "";
    setComposerError();
    addLocalMessage("user", prompt);
    await sendMessage(prompt);
  });
}

try {
  await loadConfig();
} catch {
  businessName.textContent = "Online Store Support";
}

await loadHealth();
await loadSavedMessages();
