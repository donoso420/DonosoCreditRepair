const RESEND_URL = "https://api.resend.com/emails";
const SUPABASE_ADMIN_USERS_PATH = "/auth/v1/admin/users";
const BRAND_NAME = "Donoso Credit Repair";

const CLIENT_EVENT_TYPES = new Set(["client_upload", "client_message"]);
const ADMIN_EVENT_TYPES = new Set(["admin_activity", "admin_message"]);

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatHtmlText(value) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function buildFromAddress(fromEmail) {
  const normalized = String(fromEmail || "").trim();
  if (!normalized) return normalized;
  return normalized.includes("<") ? normalized : `${BRAND_NAME} <${normalized}>`;
}

function renderInfoRows(rows = []) {
  const items = rows
    .filter((row) => row && row.label && row.value)
    .map(
      (row) => `
        <tr>
          <td style="padding:0 0 10px 0;width:150px;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#7d6a9b;">
            ${escapeHtml(row.label)}
          </td>
          <td style="padding:0 0 10px 0;font-size:15px;line-height:1.6;color:#1f1830;font-weight:600;">
            ${escapeHtml(row.value)}
          </td>
        </tr>
      `
    )
    .join("");

  if (!items) return "";

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tbody>${items}</tbody>
    </table>
  `;
}

function renderDetailCard(title, content, options = {}) {
  if (!content) return "";

  const tone = options.tone === "soft" ? "soft" : "default";
  const background = tone === "soft" ? "#fff8ef" : "#fcf9ff";
  const border = tone === "soft" ? "#f1dfbd" : "#e6ddf2";
  const labelColor = tone === "soft" ? "#9b6b19" : "#7c5cbf";

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr>
        <td style="padding:0;">
          <div style="margin:0 0 18px 0;padding:20px 22px;border:1px solid ${border};border-radius:18px;background:${background};">
            <div style="margin:0 0 10px 0;font-size:12px;line-height:1.3;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${labelColor};">
              ${escapeHtml(title)}
            </div>
            <div style="font-size:15px;line-height:1.7;color:#1f1830;">
              ${formatHtmlText(content)}
            </div>
          </div>
        </td>
      </tr>
    </table>
  `;
}

function buildEmailHtml({
  previewText = "",
  badge = "Portal Alert",
  title = "",
  subtitle = "",
  summary = "",
  infoRows = [],
  detailTitle = "",
  detailBody = "",
  detailTone = "default",
  buttonLabel = "Open Portal",
  buttonUrl = "",
  footerNote = "",
} = {}) {
  const infoTable = renderInfoRows(infoRows);
  const summaryCard = summary
    ? renderDetailCard("Summary", summary, { tone: "default" })
    : "";
  const detailCard = detailBody
    ? renderDetailCard(detailTitle || "Details", detailBody, { tone: detailTone })
    : "";
  const footerHtml = footerNote
    ? `<div style="margin-top:20px;font-size:13px;line-height:1.6;color:#6e6287;">${escapeHtml(
        footerNote
      )}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f8f4fc;color:#1f1830;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapeHtml(previewText)}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f8f4fc;">
      <tr>
        <td align="center" style="padding:28px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;max-width:640px;">
            <tr>
              <td style="padding:0 0 14px 8px;font-size:12px;line-height:1.3;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#7d6a9b;">
                ${BRAND_NAME}
              </td>
            </tr>
            <tr>
              <td style="border:1px solid #e4d9ef;border-radius:28px;overflow:hidden;background:#ffffff;">
                <div style="padding:32px;background:#1a1328;background-image:linear-gradient(135deg,#1a1328 0%,#3d2a58 55%,#6f52ba 100%);">
                  <div style="display:inline-block;padding:7px 12px;border-radius:999px;background:#f5dfa0;color:#1a1328;font-size:12px;line-height:1.2;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">
                    ${escapeHtml(badge)}
                  </div>
                  <h1 style="margin:18px 0 10px 0;font-size:30px;line-height:1.15;font-weight:800;color:#ffffff;">
                    ${escapeHtml(title)}
                  </h1>
                  <p style="margin:0;font-size:16px;line-height:1.6;color:#e8dff8;">
                    ${escapeHtml(subtitle)}
                  </p>
                </div>
                <div style="padding:30px 28px 26px 28px;">
                  ${infoTable}
                  ${summaryCard}
                  ${detailCard}
                  <div style="padding-top:6px;">
                    <a href="${escapeHtml(buttonUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#f7b2dd;color:#2f1a45;font-size:15px;line-height:1.2;font-weight:800;text-decoration:none;">
                      ${escapeHtml(buttonLabel)}
                    </a>
                  </div>
                  ${footerHtml}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 8px 0 8px;font-size:12px;line-height:1.6;color:#8a7da3;text-align:center;">
                Secure portal notification from ${BRAND_NAME}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildAdminAlert({ payload, actorEmail, adminEmail, portalLoginUrl }) {
  const clientName = payload.clientName || "Client";
  const clientEmail = actorEmail || payload.clientEmail || "Unknown";
  const isUpload = payload.eventType === "client_upload";
  const documentLabel = payload.fileTitle || payload.details || "Uploaded file";
  const subject = isUpload ? `${clientName} uploaded a document` : `${clientName} sent a portal message`;
  const intro = isUpload
    ? `${clientName} uploaded a new document to the portal.`
    : `${clientName} sent you a new message through the portal.`;
  const infoRows = [
    { label: "Client", value: clientName },
    { label: "Login Email", value: clientEmail },
  ];

  if (isUpload) {
    infoRows.push({
      label: "Document",
      value: documentLabel,
    });
    if (payload.category) {
      infoRows.push({ label: "Category", value: payload.category });
    }
  }

  const lines = [subject, "", intro, "", `Client: ${clientName}`, `Login email: ${clientEmail}`];
  if (isUpload) {
    lines.push(`Document: ${documentLabel}`);
    if (payload.category) lines.push(`Category: ${payload.category}`);
  }
  lines.push("", `Summary: ${payload.summary}`);
  if (payload.details && (!isUpload || payload.details !== documentLabel)) {
    lines.push("", isUpload ? "Notes:" : "Message:", payload.details);
  }
  lines.push("", `Open portal: ${portalLoginUrl}`);
  if (payload.clientUserId) {
    lines.push(`Internal client ID: ${payload.clientUserId}`);
  }
  lines.push("", BRAND_NAME);

  return {
    to: [adminEmail],
    reply_to: isValidEmail(clientEmail) ? normalizeEmail(clientEmail) : undefined,
    subject,
    text: lines.join("\n"),
    html: buildEmailHtml({
      previewText: intro,
      badge: isUpload ? "New Upload" : "Portal Message",
      title: isUpload ? "New Document Upload" : "New Portal Message",
      subtitle: intro,
      summary: payload.summary,
      infoRows,
      detailTitle: isUpload ? "Notes" : "Message",
      detailBody: payload.details && (!isUpload || payload.details !== documentLabel)
        ? payload.details
        : "",
      detailTone: isUpload ? "soft" : "default",
      buttonLabel: "Open Admin Portal",
      buttonUrl: portalLoginUrl,
      footerNote: payload.clientUserId
        ? `Internal client ID: ${payload.clientUserId}`
        : "This alert was sent from the secure client portal.",
    }),
  };
}

function buildClientAlert({ payload, actorEmail, recipientEmail, portalLoginUrl }) {
  const greetingName = payload.recipientName || "there";
  const isMessage = payload.eventType === "admin_message";
  const intro = isMessage
    ? "You have a new message in your Donoso Credit Repair portal."
    : "A new update was added to your Donoso Credit Repair portal.";
  const subject = isMessage
    ? "New message from Donoso Credit Repair"
    : "Your Donoso Credit Repair portal was updated";
  const lines = [`Hello ${greetingName},`, "", intro, "", `Summary: ${payload.summary}`];

  if (payload.details) {
    lines.push("", isMessage ? "Message:" : "Update details:", payload.details);
  }

  lines.push("", `Open portal: ${portalLoginUrl}`);
  if (isValidEmail(actorEmail)) {
    lines.push("Reply directly to this email if you need anything.");
  }
  lines.push("", BRAND_NAME);

  return {
    to: [recipientEmail],
    reply_to: isValidEmail(actorEmail) ? normalizeEmail(actorEmail) : undefined,
    subject,
    text: lines.join("\n"),
    html: buildEmailHtml({
      previewText: intro,
      badge: isMessage ? "New Message" : "Portal Update",
      title: isMessage ? "You Have a New Message" : "Your Portal Was Updated",
      subtitle: intro,
      summary: payload.summary,
      detailTitle: isMessage ? "Message" : "Update Details",
      detailBody: payload.details,
      buttonLabel: "Open My Portal",
      buttonUrl: portalLoginUrl,
      footerNote: isValidEmail(actorEmail)
        ? "You can reply directly to this email if you have questions."
        : "Sign in to your portal to review the latest changes.",
    }),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed." }),
    };
  }

  const resendKey = requiredEnv("RESEND_API_KEY");
  const fromEmail = requiredEnv("FROM_EMAIL");
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const adminEmail =
    requiredEnv("ADMIN_ALERTS_TO_EMAIL") || requiredEnv("LEADS_TO_EMAIL") || "donoso420@icloud.com";
  const accessToken = String(event.headers?.authorization || event.headers?.Authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!resendKey || !fromEmail || !supabaseUrl || !serviceRoleKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server notification configuration is incomplete." }),
    };
  }

  if (!accessToken) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Missing session token." }),
    };
  }

  const payload = parsePayload(event.body);
  if (!payload) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid notification payload." }),
    };
  }

  let actor;
  try {
    actor = await getAuthenticatedUser({ supabaseUrl, serviceRoleKey, accessToken });
  } catch (error) {
    return {
      statusCode: 401,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : "Could not verify session.",
      }),
    };
  }

  const portalLoginUrl = buildPortalLoginUrl();

  try {
    if (CLIENT_EVENT_TYPES.has(payload.eventType)) {
      if (!isValidEmail(adminEmail)) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Admin alert inbox is not configured with a valid email." }),
        };
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
        from: buildFromAddress(fromEmail),
        ...message,
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true }),
      };
    }

    const adminAllowed = await isAdminUser({
      supabaseUrl,
      serviceRoleKey,
      userId: actor.id,
    });

    if (!adminAllowed) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "Only admins can send client alerts." }),
      };
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
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Client email is missing for this alert." }),
      };
    }
    if (!isValidEmail(recipientEmail)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Client email is invalid for this alert." }),
      };
    }

    const message = buildClientAlert({
      payload,
      actorEmail: actor.email || "",
      recipientEmail,
      portalLoginUrl,
    });

    await sendEmail(resendKey, {
      from: buildFromAddress(fromEmail),
      ...message,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Could not send portal notification.",
        detail: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
