const adminBusinessName = document.querySelector("#adminBusinessName");
const refreshButton = document.querySelector("#refreshButton");
const conversationStat = document.querySelector("#conversationStat");
const leadStat = document.querySelector("#leadStat");
const newLeadStat = document.querySelector("#newLeadStat");
const completedLeadStat = document.querySelector("#completedLeadStat");
const conversationList = document.querySelector("#conversationList");
const leadTableBody = document.querySelector("#leadTableBody");
const adminAlert = document.querySelector("#adminAlert");

const statuses = ["new", "contacted", "completed", "cancelled"];

// --- Admin auth ---
// /api/admin/* is protected by ADMIN_TOKEN in production. The dashboard accepts
// the token via a `?token=...` URL param (captured once, then stripped from the
// URL so it is not left in history/bookmarks) or by prompting on first 401.
// The token is kept in sessionStorage so it clears when the tab closes.
const tokenKey = "ai-commerce-admin-token";

function getToken() {
  return sessionStorage.getItem(tokenKey) || "";
}

function setToken(token) {
  if (token) {
    sessionStorage.setItem(tokenKey, token);
  } else {
    sessionStorage.removeItem(tokenKey);
  }
}

(function captureTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  if (urlToken) {
    setToken(urlToken.trim());
    params.delete("token");
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
  }
})();

function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

// Fetch an admin endpoint with the stored token; on 401, prompt once for the
// token and retry. Returns the final Response.
async function adminFetch(url, options = {}) {
  let response = await fetch(url, { ...options, headers: authHeaders(options.headers) });

  if (response.status === 401) {
    const entered = window.prompt("Admin token required. Paste your ADMIN_TOKEN to continue:");
    if (entered && entered.trim()) {
      setToken(entered.trim());
      response = await fetch(url, { ...options, headers: authHeaders(options.headers) });
    }
    if (response.status === 401) {
      setToken("");
    }
  }

  return response;
}

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function setStats(stats = {}) {
  conversationStat.textContent = String(stats.conversations || 0);
  leadStat.textContent = String(stats.leads || 0);
  newLeadStat.textContent = String(stats.newLeads || 0);
  completedLeadStat.textContent = String(stats.completedLeads || 0);
}

function setAdminAlert(message = "") {
  adminAlert.textContent = message;
  adminAlert.hidden = !message;
}

function renderConversations(conversations = []) {
  conversationList.innerHTML = "";

  if (conversations.length === 0) {
    const empty = document.createElement("article");
    empty.className = "empty-admin";
    const title = document.createElement("strong");
    title.textContent = "No conversations yet";
    const copy = document.createElement("span");
    copy.textContent = "Send a message in the chat workspace to populate this panel.";
    empty.append(title, copy);
    conversationList.append(empty);
    return;
  }

  for (const conversation of conversations) {
    const item = document.createElement("article");
    item.className = "conversation-item";

    const title = document.createElement("strong");
    title.textContent = conversation.customerName || "Unknown customer";

    const meta = document.createElement("span");
    meta.textContent = `${conversation.requestType} / ${conversation.status} / ${conversation.messageCount} messages`;

    const latest = document.createElement("span");
    latest.textContent = conversation.latestMessage || "No message preview";

    const time = document.createElement("span");
    time.textContent = formatDate(conversation.lastMessageAt);

    item.append(title, meta, latest, time);
    conversationList.append(item);
  }
}

function createStatusSelect(lead) {
  const select = document.createElement("select");

  for (const status of statuses) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    option.selected = lead.status === status;
    select.append(option);
  }

  select.addEventListener("change", async () => {
    select.disabled = true;

    try {
      const response = await adminFetch(`/api/admin/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: select.value }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Status update failed.");
      }

      await loadDashboard();
    } catch (error) {
      alert(error.message);
      select.value = lead.status;
    } finally {
      select.disabled = false;
    }
  });

  return select;
}

function renderLeads(leads = []) {
  leadTableBody.innerHTML = "";

  if (leads.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-admin";
    cell.colSpan = 4;
    const title = document.createElement("strong");
    title.textContent = "No leads captured yet";
    const copy = document.createElement("span");
    copy.textContent = "Customer requests with buying or order intent will appear here.";
    cell.append(title, copy);
    row.append(cell);
    leadTableBody.append(row);
    return;
  }

  for (const lead of leads) {
    const row = document.createElement("tr");

    const customer = document.createElement("td");
    const customerName = document.createElement("strong");
    customerName.textContent = lead.customerName || "Unknown";
    const contact = document.createElement("span");
    contact.textContent = [lead.email, lead.phone].filter(Boolean).join(" / ") || "No contact yet";
    customer.append(customerName, contact);

    const request = document.createElement("td");
    const requestType = document.createElement("strong");
    requestType.textContent = lead.requestType || "customer inquiry";
    const products = document.createElement("span");
    products.textContent =
      (lead.productInterest || []).join(", ") || lead.need || "No product listed";
    request.append(requestType, products);

    const details = document.createElement("td");
    const preferred = document.createElement("strong");
    preferred.textContent = lead.preferredDateTime || lead.orderNumber || "Pending details";
    const notes = document.createElement("span");
    notes.textContent = lead.notes || "No notes";
    details.append(preferred, notes);

    const status = document.createElement("td");
    status.append(createStatusSelect(lead));

    row.append(customer, request, details, status);
    leadTableBody.append(row);
  }
}

async function loadDashboard() {
  refreshButton.disabled = true;

  try {
    setAdminAlert();
    const response = await adminFetch("/api/admin/summary");
    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      throw new Error(
        data.error ||
          "Unauthorized. Add ?token=YOUR_ADMIN_TOKEN to the URL or enter it when prompted."
      );
    }

    if (!response.ok) {
      throw new Error(data.error || "Dashboard failed to load.");
    }

    adminBusinessName.textContent = `${data.businessName || "Store"} Admin`;
    setStats(data.stats);
    renderConversations(data.conversations);
    renderLeads(data.leads);
  } catch (error) {
    setAdminAlert(error.message);
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", loadDashboard);

await loadDashboard();
