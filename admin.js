import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.__PORTAL_CONFIG__ || {};

const authCard = document.getElementById("auth-card");
const adminApp = document.getElementById("admin-app");
const authForm = document.getElementById("admin-auth-form");
const authStatus = document.getElementById("admin-auth-status");
const adminStatus = document.getElementById("admin-status");
const adminIdentity = document.getElementById("admin-identity");

const profileForm = document.getElementById("profile-form");
const clientSelect = document.getElementById("client-select");
const activeClientIdEl = document.getElementById("active-client-id");

const snapshotForm = document.getElementById("snapshot-form");
const letterForm = document.getElementById("letter-form");
const letterUpdateForm = document.getElementById("letter-update-form");
const timelineForm = document.getElementById("timeline-form");
const fileUploadForm = document.getElementById("file-upload-form");

const inviteForm = document.getElementById("invite-form");
const inviteStatus = document.getElementById("invite-status");

const refreshAllBtn = document.getElementById("refresh-all-btn");
const logoutBtn = document.getElementById("admin-logout-btn");

const previewScores = document.getElementById("preview-scores");
const previewLetters = document.getElementById("preview-letters");
const previewUpdates = document.getElementById("preview-updates");
const previewFiles = document.getElementById("preview-files");
const adminMessageThread = document.getElementById("admin-message-thread");
const adminMessageForm = document.getElementById("admin-message-form");
const adminMessageInput = document.getElementById("admin-message-input");
const previewClientUploads = document.getElementById("preview-client-uploads");

const missingConfig = ["supabaseUrl", "supabaseAnonKey"].filter((k) => !config[k]);
let supabase = null;
let currentAdmin = null;
let activeClientId = null;

function setAuthStatus(message, isError = false) {
  if (!authStatus) return;
  authStatus.textContent = message;
  authStatus.classList.toggle("error", isError);
}

function setAdminStatus(message, isError = false) {
  if (!adminStatus) return;
  adminStatus.textContent = message;
  adminStatus.classList.toggle("error", isError);
}

function showAuth() {
  authCard?.classList.remove("hidden");
  adminApp?.classList.add("hidden");
}

function showAdmin() {
  authCard?.classList.add("hidden");
  adminApp?.classList.remove("hidden");
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString();
}

function safeText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sanitizeFileName(name) {
  return String(name || "file")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function prefillProfileUserId(userId) {
  const input = document.getElementById("profile-user-id");
  if (!input || !isUuid(userId)) return;
  if (!String(input.value || "").trim()) {
    input.value = userId;
  }
}

async function checkAdmin(userId) {
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return false;
  return Boolean(data?.user_id);
}

async function loadClients() {
  const { data, error } = await supabase
    .from("client_profiles")
    .select("user_id,full_name,phone")
    .order("full_name", { ascending: true });

  if (error) {
    setAdminStatus("Could not load clients: " + error.message, true);
    return;
  }

  clientSelect.innerHTML = "";
  if (!data || data.length === 0) {
    clientSelect.innerHTML = '<option value="">No clients yet</option>';
    activeClientId = null;
    activeClientIdEl.textContent = "";
    renderPreview([], [], [], []);
    return;
  }

  for (const row of data) {
    const option = document.createElement("option");
    option.value = row.user_id;
    const name = row.full_name || "Unnamed Client";
    option.textContent = `${name} (${row.user_id.slice(0, 8)}...)`;
    clientSelect.appendChild(option);
  }

  if (!activeClientId || !data.some((x) => x.user_id === activeClientId)) {
    activeClientId = data[0].user_id;
  }
  clientSelect.value = activeClientId;
  activeClientIdEl.textContent = `Active user_id: ${activeClientId}`;
  await loadClientPreview(activeClientId);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString();
}

function renderAdminMessages(messages) {
  if (!adminMessageThread) return;
  if (!messages || !messages.length) {
    adminMessageThread.innerHTML = '<li class="muted">No messages from this client yet.</li>';
    return;
  }
  adminMessageThread.innerHTML = messages
    .map((row) => {
      const isClient = row.sender_role === "client";
      const label = isClient ? "Client" : "You (Admin)";
      const cls = isClient ? "msg-from-client" : "msg-from-admin";
      return `<li class="${cls}"><strong>${safeText(label)}</strong> · ${safeText(formatDateTime(row.created_at))}<br>${safeText(row.content)}</li>`;
    })
    .join("");
  adminMessageThread.scrollTop = adminMessageThread.scrollHeight;
}

function renderClientUploads(files) {
  if (!previewClientUploads) return;
  const uploads = (files || []).filter((f) => f.uploaded_by === "client");
  if (!uploads.length) {
    previewClientUploads.innerHTML = "<li>No client uploads yet.</li>";
    return;
  }
  previewClientUploads.innerHTML = uploads
    .map((f) => {
      const link = f.signed_url
        ? `<a href="${safeText(f.signed_url)}" target="_blank" rel="noopener noreferrer">Open file</a>`
        : "Link unavailable";
      return `<li>${safeText(f.title || f.file_name || "File")} · ${safeText(formatDate(f.created_at))} — ${link}</li>`;
    })
    .join("");
}

function renderPreview(scores, letters, updates, files) {
  previewScores.innerHTML = "";
  previewLetters.innerHTML = "";
  previewUpdates.innerHTML = "";
  previewFiles.innerHTML = "";

  if (!scores.length) {
    previewScores.innerHTML = "<li>No score records yet.</li>";
  } else {
    for (const row of scores) {
      const li = document.createElement("li");
      li.innerHTML = `${safeText(row.bureau)}: <strong>${safeText(row.score)}</strong> (${safeText(
        formatDate(row.reported_at)
      )})`;
      previewScores.appendChild(li);
    }
  }

  if (!letters.length) {
    previewLetters.innerHTML = "<li>No letter records yet.</li>";
  } else {
    for (const row of letters) {
      const li = document.createElement("li");
      li.innerHTML = `#${safeText(row.id)} - ${safeText(row.recipient || row.bureau || "N/A")} / ${safeText(
        row.tracking_number
      )} / ${safeText(row.status)}`;
      previewLetters.appendChild(li);
    }
  }

  if (!updates.length) {
    previewUpdates.innerHTML = "<li>No updates yet.</li>";
  } else {
    for (const row of updates) {
      const li = document.createElement("li");
      li.innerHTML = `${safeText(formatDate(row.created_at))}: ${safeText(row.details)}`;
      previewUpdates.appendChild(li);
    }
  }

  if (!files.length) {
    previewFiles.innerHTML = "<li>No files yet.</li>";
  } else {
    for (const row of files) {
      const li = document.createElement("li");
      li.innerHTML = `${safeText(row.category || "File")}: ${safeText(
        row.title || row.file_name || "Attachment"
      )}`;
      previewFiles.appendChild(li);
    }
  }
}

async function loadClientPreview(userId) {
  if (!userId) return;
  const [{ data: scores }, { data: letters }, { data: updates }, { data: files }, { data: messages }] =
    await Promise.all([
      supabase.from("credit_snapshots").select("bureau,score,reported_at").eq("user_id", userId).order("reported_at", { ascending: false }).limit(6),
      supabase.from("client_letters").select("id,recipient,bureau,tracking_number,status,sent_date").eq("user_id", userId).order("sent_date", { ascending: false }).limit(8),
      supabase.from("client_updates").select("details,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(8),
      supabase.from("client_files").select("title,category,file_name,file_path,bucket,created_at,uploaded_by").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
      supabase.from("portal_messages").select("sender_role,content,created_at").eq("user_id", userId).order("created_at", { ascending: true }),
    ]);

  const allFiles = files || [];

  // Generate signed URLs for client uploads so admin can open them
  const filesWithUrls = await Promise.all(
    allFiles.map(async (f) => {
      if (f.uploaded_by !== "client") return f;
      const { data } = await supabase.storage
        .from(f.bucket || "client-docs")
        .createSignedUrl(f.file_path, 60 * 60);
      return { ...f, signed_url: data?.signedUrl || "" };
    })
  );

  renderPreview(scores || [], letters || [], updates || [], filesWithUrls.filter((f) => f.uploaded_by !== "client"));
  renderAdminMessages(messages || []);
  renderClientUploads(filesWithUrls);
}

function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabPanels.forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(`tab-${target}`)?.classList.remove("hidden");
    });
  });
}

async function requireActiveClient() {
  if (!activeClientId) {
    setAdminStatus("Select a client first.", true);
    return false;
  }
  return true;
}

function initialize() {
  if (missingConfig.length > 0) {
    setAuthStatus(
      "Admin portal is not configured yet. Add Supabase values in portal-config.js.",
      true
    );
    authForm?.querySelectorAll("input,button").forEach((el) => {
      el.disabled = true;
    });
    return;
  }

  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(document.getElementById("admin-email")?.value || "").trim();
    const password = String(document.getElementById("admin-password")?.value || "");
    if (!email || !password) {
      setAuthStatus("Enter admin email and password.", true);
      return;
    }

    setAuthStatus("Signing in...");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setAuthStatus(error?.message || "Could not sign in.", true);
      return;
    }

    const allowed = await checkAdmin(data.user.id);
    if (!allowed) {
      await supabase.auth.signOut();
      setAuthStatus("Access denied. This account is not in admin_users.", true);
      showAuth();
      return;
    }

    currentAdmin = data.user;
    adminIdentity.textContent = `Signed in as ${data.user.email}`;
    prefillProfileUserId(data.user.id);
    showAdmin();
    initTabs();
    setAuthStatus("");
    setAdminStatus("Admin session ready.");
    await loadClients();
  });

  clientSelect?.addEventListener("change", async () => {
    activeClientId = clientSelect.value || null;
    activeClientIdEl.textContent = activeClientId ? `Active user_id: ${activeClientId}` : "";
    await loadClientPreview(activeClientId);
  });

  refreshAllBtn?.addEventListener("click", async () => {
    await loadClients();
    setAdminStatus("Data refreshed.");
  });

  logoutBtn?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    currentAdmin = null;
    window.location.href = "admin.html";
  });

  inviteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(document.getElementById("invite-email")?.value || "").trim();
    const fullName = String(document.getElementById("invite-name")?.value || "").trim();
    const phone = String(document.getElementById("invite-phone")?.value || "").trim();

    if (!email) {
      if (inviteStatus) { inviteStatus.textContent = "Email is required."; inviteStatus.classList.add("error"); }
      return;
    }

    if (inviteStatus) { inviteStatus.textContent = "Sending invite..."; inviteStatus.classList.remove("error"); }

    const res = await fetch("/api/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, fullName }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (inviteStatus) { inviteStatus.textContent = "Error: " + (data.error || "Could not send invite."); inviteStatus.classList.add("error"); }
      return;
    }

    const userId = data.userId;

    // Auto-create client profile so they appear in the dropdown immediately
    if (userId) {
      await supabase.from("client_profiles").upsert(
        { user_id: userId, full_name: fullName || null, phone: phone || null },
        { onConflict: "user_id" }
      );
      activeClientId = userId;
    }

    inviteForm.reset();
    if (inviteStatus) { inviteStatus.textContent = `✓ Invite sent to ${email}. They'll get an email with a login link.`; inviteStatus.classList.remove("error"); }
    await loadClients();
  });

  profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rawUserId = String(document.getElementById("profile-user-id")?.value || "").trim();
    const userId = rawUserId || String(currentAdmin?.id || "");
    const fullName = String(document.getElementById("profile-full-name")?.value || "").trim();
    const phone = String(document.getElementById("profile-phone")?.value || "").trim();

    if (!isUuid(userId)) {
      setAdminStatus(
        "Client User ID must be a valid UUID (example: 39748f68-10c8-4de4-8eb8-29a5dba5f0b6).",
        true
      );
      return;
    }
    const userIdInput = document.getElementById("profile-user-id");
    if (userIdInput) userIdInput.value = userId;

    const { error } = await supabase.from("client_profiles").upsert(
      {
        user_id: userId,
        full_name: fullName || null,
        phone: phone || null,
      },
      { onConflict: "user_id" }
    );

    if (error) {
      setAdminStatus("Could not save profile: " + error.message, true);
      return;
    }

    activeClientId = userId;
    setAdminStatus("Profile saved.");
    await loadClients();
  });

  snapshotForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const bureau = String(document.getElementById("snapshot-bureau")?.value || "");
    const score = Number(document.getElementById("snapshot-score")?.value || 0);
    const reportedAt = String(document.getElementById("snapshot-date")?.value || "");

    if (!reportedAt || !score) {
      setAdminStatus("Score and reported date are required.", true);
      return;
    }

    const { error } = await supabase.from("credit_snapshots").insert({
      user_id: activeClientId,
      bureau,
      score,
      reported_at: reportedAt,
    });

    if (error) {
      setAdminStatus("Could not add snapshot: " + error.message, true);
      return;
    }

    snapshotForm.reset();
    setAdminStatus("Snapshot added.");
    await loadClientPreview(activeClientId);
  });

  letterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const sentDate = String(document.getElementById("letter-date")?.value || "");
    const recipient = String(document.getElementById("letter-recipient")?.value || "").trim();
    const tracking = String(document.getElementById("letter-tracking")?.value || "").trim();
    const status = String(document.getElementById("letter-status")?.value || "").trim();
    const notes = String(document.getElementById("letter-notes")?.value || "").trim();

    if (!sentDate || !recipient || !tracking) {
      setAdminStatus("Sent date, recipient, and tracking number are required.", true);
      return;
    }

    const { error } = await supabase.from("client_letters").insert({
      user_id: activeClientId,
      sent_date: sentDate,
      recipient,
      bureau: recipient,
      tracking_number: tracking,
      status,
      notes: notes || null,
    });

    if (error) {
      setAdminStatus("Could not add letter record: " + error.message, true);
      return;
    }

    letterForm.reset();
    setAdminStatus("Letter record added.");
    await loadClientPreview(activeClientId);
  });

  letterUpdateForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const letterId = Number(document.getElementById("letter-id")?.value || 0);
    const status = String(document.getElementById("letter-update-status")?.value || "").trim();
    const notes = String(document.getElementById("letter-update-notes")?.value || "").trim();

    if (!letterId) {
      setAdminStatus("Letter ID is required.", true);
      return;
    }

    const { error } = await supabase
      .from("client_letters")
      .update({ status, notes: notes || null })
      .eq("id", letterId);

    if (error) {
      setAdminStatus("Could not update letter: " + error.message, true);
      return;
    }

    letterUpdateForm.reset();
    setAdminStatus("Letter status updated.");
    if (activeClientId) await loadClientPreview(activeClientId);
  });

  timelineForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const details = String(document.getElementById("timeline-details")?.value || "").trim();
    if (!details) {
      setAdminStatus("Update details are required.", true);
      return;
    }

    const { error } = await supabase.from("client_updates").insert({
      user_id: activeClientId,
      details,
    });

    if (error) {
      setAdminStatus("Could not add timeline update: " + error.message, true);
      return;
    }

    timelineForm.reset();
    setAdminStatus("Timeline update added.");
    await loadClientPreview(activeClientId);
  });

  fileUploadForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const fileInput = document.getElementById("file-input");
    const file = fileInput?.files?.[0];
    const category = String(document.getElementById("file-category")?.value || "").trim();
    const notes = String(document.getElementById("file-notes")?.value || "").trim();
    const titleInput = String(document.getElementById("file-title")?.value || "").trim();

    if (!file) {
      setAdminStatus("Choose a file to upload.", true);
      return;
    }

    const allowedTypes = new Set([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
    if (!allowedTypes.has(file.type)) {
      setAdminStatus("Only PDF, PNG, JPG, or WebP files are allowed.", true);
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setAdminStatus("File must be 15MB or smaller.", true);
      return;
    }

    const bucket = "client-docs";
    const safeName = sanitizeFileName(file.name);
    const objectPath = `${activeClientId}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, file, {
      upsert: false,
      contentType: file.type,
    });

    if (uploadError) {
      setAdminStatus("Could not upload file: " + uploadError.message, true);
      return;
    }

    const { error: rowError } = await supabase.from("client_files").insert({
      user_id: activeClientId,
      bucket,
      file_path: objectPath,
      file_name: file.name,
      content_type: file.type,
      file_size: file.size,
      category: category || "Other",
      title: titleInput || file.name,
      notes: notes || null,
    });

    if (rowError) {
      setAdminStatus("File uploaded but metadata save failed: " + rowError.message, true);
      return;
    }

    fileUploadForm.reset();
    setAdminStatus("File uploaded and attached to client record.");
    await loadClientPreview(activeClientId);
  });

  adminMessageForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;
    const content = String(adminMessageInput?.value || "").trim();
    if (!content) { setAdminStatus("Message cannot be empty.", true); return; }

    const { error } = await supabase.from("portal_messages").insert({
      user_id: activeClientId,
      sender_role: "admin",
      content,
    });

    if (error) { setAdminStatus("Could not send message: " + error.message, true); return; }
    if (adminMessageInput) adminMessageInput.value = "";
    setAdminStatus("Message sent.");
    await loadClientPreview(activeClientId);
  });

  supabase.auth.getSession().then(async ({ data }) => {
    const user = data.session?.user;
    if (!user) {
      showAuth();
      return;
    }
    const allowed = await checkAdmin(user.id);
    if (!allowed) {
      await supabase.auth.signOut();
      showAuth();
      setAuthStatus("Access denied. This account is not in admin_users.", true);
      return;
    }
    currentAdmin = user;
    adminIdentity.textContent = `Signed in as ${user.email}`;
    prefillProfileUserId(user.id);
    showAdmin();
    await loadClients();
  });
}

initialize();
