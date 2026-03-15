const RESEND_URL = "https://api.resend.com/emails";
const SUPABASE_ADMIN_USERS_PATH = "/auth/v1/admin/users";

const CLIENT_EVENT_TYPES = new Set(["client_upload", "client_message"]);
const ADMIN_EVENT_TYPES = new Set(["admin_activity", "admin_message"]);

function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(payload));
}

function requiredEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return normalizeEmail(value).includes("@");
}

function normalizeText(value, maxLength = 4000) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function parseMaybeJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildPortalLoginUrl() {
  const explicit = requiredEnv("PORTAL_LOGIN_URL");
  if (explicit) return explicit;

  const siteUrl = requiredEnv("SITE_URL") || requiredEnv("PUBLIC_SITE_URL");
  if (siteUrl) {
    return `${siteUrl.replace(/\/+$/, "")}/portal.html`;
  }

  return "http://localhost:8080/portal.html";
}

function formatSupabaseError(status, data, rawText) {
  const message =
    (data && (data.msg || data.message || data.error_description || data.error)) || rawText;
  return `Supabase request failed (${status}): ${String(message || "Unknown error")}`;
}

async function supabaseRequest({
  supabaseUrl,
  serviceRoleKey,
  path,
  method = "GET",
  headers = {},
  body,
}) {
  const base = supabaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  const rawText = await response.text();
  const data = parseMaybeJson(rawText);
  if (!response.ok) {
    throw new Error(formatSupabaseError(response.status, data, rawText));
  }

  return data;
}

async function getAuthenticatedUser({ supabaseUrl, serviceRoleKey, accessToken }) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const rawText = await response.text();
  const data = parseMaybeJson(rawText);
  if (!response.ok) {
    throw new Error(formatSupabaseError(response.status, data, rawText));
  }

  return data;
}

async function isAdminUser({ supabaseUrl, serviceRoleKey, userId }) {
  const data = await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path: `/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  });

  return Array.isArray(data) && data.length > 0;
}

async function findAuthUserById({ supabaseUrl, serviceRoleKey, userId }) {
  const data = await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path: `${SUPABASE_ADMIN_USERS_PATH}?page=1&per_page=1000`,
  });

  const users = Array.isArray(data?.users) ? data.users : [];
  return users.find((user) => String(user?.id || "") === String(userId || "")) || null;
}

async function sendEmail(apiKey, message) {
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${body}`);
  }
}

function parsePayload(rawBody) {
  const body = typeof rawBody === "string" ? parseMaybeJson(rawBody) : rawBody;
  if (!body || typeof body !== "object") return null;

  const payload = {
    eventType: normalizeText(body.eventType, 40),
    summary: normalizeText(body.summary, 240),
    details: normalizeText(body.details, 4000),
    fileTitle: normalizeText(body.fileTitle, 240),
    category: normalizeText(body.category, 120),
    clientName: normalizeText(body.clientName, 160),
    clientEmail: normalizeEmail(body.clientEmail),
    clientUserId: normalizeText(body.clientUserId, 120),
    recipientName: normalizeText(body.recipientName, 160),
    recipientEmail: normalizeEmail(body.recipientEmail),
    recipientUserId: normalizeText(body.recipientUserId, 120),
  };

  if (!payload.summary) return null;
  if (!CLIENT_EVENT_TYPES.has(payload.eventType) && !ADMIN_EVENT_TYPES.has(payload.eventType)) {
    return null;
  }

  return payload;
}

function buildAdminAlert({ payload, actorEmail, adminEmail, portalLoginUrl }) {
  const clientName = payload.clientName || "Client";
  const clientEmail = actorEmail || payload.clientEmail || "Unknown";
  const lines = [
    payload.eventType === "client_upload"
      ? "A client uploaded a new document to the portal."
      : "A client sent a new portal message.",
    "",
    `Client: ${clientName}`,
    `Login email: ${clientEmail}`,
  ];

  if (payload.clientUserId) {
    lines.push(`Client ID: ${payload.clientUserId}`);
  }

  if (payload.eventType === "client_upload") {
    lines.push(`Document: ${payload.fileTitle || payload.details || "Uploaded file"}`);
    if (payload.category) lines.push(`Category: ${payload.category}`);
  }

  lines.push("", `Summary: ${payload.summary}`);

  if (payload.details) {
    lines.push("", "Details:", payload.details);
  }

  lines.push("", `Portal: ${portalLoginUrl}`, "", "Donoso Credit Repair");

  return {
    to: [adminEmail],
    reply_to: isValidEmail(clientEmail) ? normalizeEmail(clientEmail) : undefined,
    subject:
      payload.eventType === "client_upload"
        ? `Client upload: ${clientName}`
        : `Portal message from ${clientName}`,
    text: lines.join("\n"),
  };
}

function buildClientAlert({ payload, actorEmail, recipientEmail, portalLoginUrl }) {
  const greetingName = payload.recipientName || "there";
  const intro =
    payload.eventType === "admin_message"
      ? "You have a new message in your Donoso Credit Repair portal."
      : "A change was made in your Donoso Credit Repair portal.";
  const lines = [`Hello ${greetingName},`, "", intro, "", `Summary: ${payload.summary}`];

  if (payload.details) {
    lines.push("", "Details:", payload.details);
  }

  lines.push("", `Sign in here: ${portalLoginUrl}`, "", "Donoso Credit Repair");

  return {
    to: [recipientEmail],
    reply_to: isValidEmail(actorEmail) ? normalizeEmail(actorEmail) : undefined,
    subject:
      payload.eventType === "admin_message"
        ? "New message from Donoso Credit Repair"
        : "Portal update from Donoso Credit Repair",
    text: lines.join("\n"),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed." });
  }

  const resendKey = requiredEnv("RESEND_API_KEY");
  const fromEmail = requiredEnv("FROM_EMAIL");
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const adminEmail = requiredEnv("ADMIN_ALERTS_TO_EMAIL") || requiredEnv("LEADS_TO_EMAIL") || "donoso420@icloud.com";
  const accessToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();

  if (!resendKey || !fromEmail || !supabaseUrl || !serviceRoleKey) {
    return json(res, 500, { error: "Server notification configuration is incomplete." });
  }

  if (!accessToken) {
    return json(res, 401, { error: "Missing session token." });
  }

  const payload = parsePayload(req.body);
  if (!payload) {
    return json(res, 400, { error: "Invalid notification payload." });
  }

  let actor;
  try {
    actor = await getAuthenticatedUser({ supabaseUrl, serviceRoleKey, accessToken });
  } catch (error) {
    return json(res, 401, { error: error instanceof Error ? error.message : "Could not verify session." });
  }

  const portalLoginUrl = buildPortalLoginUrl();

  try {
    if (CLIENT_EVENT_TYPES.has(payload.eventType)) {
      if (!isValidEmail(adminEmail)) {
        return json(res, 500, { error: "Admin alert inbox is not configured with a valid email." });
      }

      payload.clientUserId = actor.id || payload.clientUserId;
      payload.clientEmail = actor.email || payload.clientEmail;
      const message = buildAdminAlert({
        payload,
        actorEmail: actor.email || "",
        adminEmail,
        portalLoginUrl,
      });

      await sendEmail(resendKey, {
        from: fromEmail,
        ...message,
      });

      return json(res, 200, { ok: true });
    }

    const adminAllowed = await isAdminUser({
      supabaseUrl,
      serviceRoleKey,
      userId: actor.id,
    });

    if (!adminAllowed) {
      return json(res, 403, { error: "Only admins can send client alerts." });
    }

    let recipientEmail = payload.recipientEmail;
    if (!recipientEmail && payload.recipientUserId) {
      const authUser = await findAuthUserById({
        supabaseUrl,
        serviceRoleKey,
        userId: payload.recipientUserId,
      });
      recipientEmail = normalizeEmail(authUser?.email);
    }

    if (!recipientEmail) {
      return json(res, 400, { error: "Client email is missing for this alert." });
    }
    if (!isValidEmail(recipientEmail)) {
      return json(res, 400, { error: "Client email is invalid for this alert." });
    }

    const message = buildClientAlert({
      payload,
      actorEmail: actor.email || "",
      recipientEmail,
      portalLoginUrl,
    });

    await sendEmail(resendKey, {
      from: fromEmail,
      ...message,
    });

    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, 500, {
      error: "Could not send portal notification.",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
