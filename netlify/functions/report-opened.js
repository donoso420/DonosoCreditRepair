function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function getEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getBearerToken(headers = {}) {
  const header = headers.authorization || headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function getAuthenticatedUser({ supabaseUrl, serviceRoleKey, accessToken }) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json().catch(() => null);
}

function parseBody(body) {
  if (!body) return null;
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, {
      error: "Server not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to host env vars.",
    });
  }

  const body = parseBody(event.body);
  const reportId = Number(body?.reportId || 0);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return json(400, { error: "A valid reportId is required." });
  }

  const accessToken = getBearerToken(event.headers || {});
  if (!accessToken) {
    return json(401, { error: "Missing bearer token." });
  }

  const user = await getAuthenticatedUser({ supabaseUrl, serviceRoleKey, accessToken });
  if (!user?.id) {
    return json(401, { error: "Invalid session." });
  }

  const query = new URLSearchParams({
    id: `eq.${reportId}`,
    user_id: `eq.${user.id}`,
    verification_status: "in.(pending,needs_review)",
    select: "id,verification_status",
  });

  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/credit_reports?${query.toString()}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        verification_status: "reviewed",
        verified_at: new Date().toISOString(),
      }),
    }
  );

  const rawText = await response.text();
  let data = [];
  try {
    data = rawText ? JSON.parse(rawText) : [];
  } catch {
    data = [];
  }

  if (!response.ok) {
    return json(400, {
      error: data?.message || data?.error || "Could not mark report reviewed.",
    });
  }

  return json(200, {
    updated: Array.isArray(data) && data.length > 0,
  });
};
