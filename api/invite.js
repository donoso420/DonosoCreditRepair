export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: "Server not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Vercel env vars." });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "Invalid request body." });
    return;
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const fullName = String(body?.fullName || "").trim();

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "A valid email address is required." });
    return;
  }

  const siteUrl = process.env.SITE_URL || "https://donosocreditrepair.com";
  const redirectTo = `${siteUrl}/portal.html`;

  const response = await fetch(`${supabaseUrl}/auth/v1/invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      email,
      data: { full_name: fullName || "" },
      redirect_to: redirectTo,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    res.status(400).json({ error: err.msg || err.message || "Failed to send invite." });
    return;
  }

  const user = await response.json();
  res.status(200).json({ userId: user.id, email: user.email });
}
