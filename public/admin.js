const adminBusinessName = document.querySelector("#adminBusinessName");
const refreshButton = document.querySelector("#refreshButton");
const conversationStat = document.querySelector("#conversationStat");
const leadStat = document.querySelector("#leadStat");
const newLeadStat = document.querySelector("#newLeadStat");
const completedLeadStat = document.querySelector("#completedLeadStat");
const conversationList = document.querySelector("#conversationList");
const leadTableBody = document.querySelector("#leadTableBody");
const adminAlert = document.querySelector("#adminAlert");
const adminAuthPanel = document.querySelector("#adminAuthPanel");
const adminLoginForm = document.querySelector("#adminLoginForm");
const adminTokenInput = document.querySelector("#adminTokenInput");
const adminLoginStatus = document.querySelector("#adminLoginStatus");
const statsGrid = document.querySelector("#statsGrid");
const adminContent = document.querySelector("#adminContent");
const logoutButton = document.querySelector("#logoutButton");

const statuses = ["new", "contacted", "completed", "cancelled"];

// --- Admin auth ---
// /api/admin/* accepts ADMIN_TOKEN only in an Authorization header. The token is
// kept in sessionStorage so it never enters the URL and clears with the tab.
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

function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

async function adminFetch(url, options = {}) {
  const response = await fetch(url, { ...options, headers: authHeaders(options.headers) });
  if (response.status === 401) {
    setToken("");
    setDashboardVisibility(false);
    setLoginStatus("That token was not accepted. Check ADMIN_TOKEN and try again.");
  }
  return response;
}

function setLoginStatus(message = "") {
  adminLoginStatus.textContent = message;
}

function setDashboardVisibility(unlocked) {
  adminAuthPanel.hidden = unlocked;
  statsGrid.hidden = !unlocked;
  adminContent.hidden = !unlocked;
  logoutButton.hidden = !unlocked;
  refreshButton.disabled = !unlocked;

  if (!unlocked) {
    adminTokenInput.focus();
  }
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
  select.setAttribute("aria-label", `Status for ${lead.customerName || "unknown customer"}`);

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
  if (!getToken()) {
    setDashboardVisibility(false);
    setLoginStatus("Enter ADMIN_TOKEN to unlock customer data.");
    return false;
  }

  refreshButton.disabled = true;

  try {
    setAdminAlert();
    const response = await adminFetch("/api/admin/summary");
    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      return false;
    }

    if (!response.ok) {
      throw new Error(data.error || "Dashboard failed to load.");
    }

    adminBusinessName.textContent = `${data.businessName || "Store"} Admin`;
    setStats(data.stats);
    renderConversations(data.conversations);
    renderLeads(data.leads);
    setDashboardVisibility(true);
    setLoginStatus();
    return true;
  } catch (error) {
    setAdminAlert(error.message);
    return false;
  } finally {
    refreshButton.disabled = !getToken();
  }
}

refreshButton.addEventListener("click", loadDashboard);

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = adminTokenInput.value.trim();

  if (!token) {
    setLoginStatus("Enter the configured admin token.");
    adminTokenInput.focus();
    return;
  }

  setToken(token);
  setLoginStatus("Checking token…");
  const unlocked = await loadDashboard();

  if (unlocked) {
    adminLoginForm.reset();
  }
});

logoutButton.addEventListener("click", () => {
  setToken("");
  setStats();
  renderConversations();
  renderLeads();
  setAdminAlert();
  setDashboardVisibility(false);
  setLoginStatus("Dashboard locked. Enter ADMIN_TOKEN to continue.");
});

await loadDashboard();
