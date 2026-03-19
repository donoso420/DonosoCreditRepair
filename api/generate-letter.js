export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceRoleKey || !anthropicKey) {
    res.status(500).json({ error: "Server not configured. Check Vercel environment variables." });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "Invalid request body." });
    return;
  }

  const { userId, bureau, negativeItemIds, bureauResponseText } = body || {};

  if (!userId) {
    res.status(400).json({ error: "userId is required." });
    return;
  }
  if (!bureau) {
    res.status(400).json({ error: "bureau is required." });
    return;
  }
  if (!negativeItemIds || !negativeItemIds.length) {
    res.status(400).json({ error: "At least one negative item must be selected." });
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };

  // Fetch client profile
  const profileRes = await fetch(
    `${supabaseUrl}/rest/v1/client_profiles?user_id=eq.${userId}&select=full_name,phone,address,contact_email`,
    { headers }
  );
  if (!profileRes.ok) {
    res.status(500).json({ error: "Could not fetch client profile." });
    return;
  }
  const profiles = await profileRes.json();
  const profile = profiles[0];
  if (!profile) {
    res.status(404).json({ error: "Client profile not found." });
    return;
  }

  // Fetch selected negative items
  const idsParam = negativeItemIds.map((id) => `id=eq.${id}`).join(",");
  const itemsRes = await fetch(
    `${supabaseUrl}/rest/v1/negative_items?user_id=eq.${userId}&or=(${idsParam})&select=id,creditor,item_type,bureau,balance,account_reference,status,notes`,
    { headers }
  );
  if (!itemsRes.ok) {
    res.status(500).json({ error: "Could not fetch negative items." });
    return;
  }
  const negativeItems = await itemsRes.json();
  if (!negativeItems.length) {
    res.status(404).json({ error: "No matching negative items found." });
    return;
  }

  // Build the prompt
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const clientName = profile.full_name || "Client";
  const clientAddress = profile.address || "[Address on file]";
  const clientEmail = profile.contact_email || "";
  const clientPhone = profile.phone || "";

  const bureauAddresses = {
    Equifax: "Equifax Credit Information Services, Inc.\nP.O. Box 740256\nAtlanta, GA 30374",
    Experian: "Experian\nP.O. Box 4500\nAllen, TX 75013",
    TransUnion: "TransUnion LLC\nConsumer Dispute Center\nP.O. Box 2000\nChester, PA 19016",
  };
  const bureauAddress = bureauAddresses[bureau] || `${bureau}\n[Bureau Address]`;

  const itemsList = negativeItems
    .map((item, i) => {
      const parts = [`ITEM ${i + 1}: ${item.creditor} — ${item.item_type}`];
      if (item.account_reference) parts.push(`Account: ${item.account_reference}`);
      if (item.balance) parts.push(`Balance: $${Number(item.balance).toFixed(2)}`);
      if (item.status) parts.push(`Status: ${item.status}`);
      if (item.notes) parts.push(`Notes: ${item.notes}`);
      return parts.join(", ");
    })
    .join("\n");

  let prompt;

  if (bureauResponseText) {
    // Follow-up letter responding to bureau's response
    prompt = `You are a professional credit repair specialist. Write a formal follow-up dispute letter based on the bureau's response.

CLIENT INFORMATION:
Name: ${clientName}
Address: ${clientAddress}
${clientEmail ? `Email: ${clientEmail}` : ""}
${clientPhone ? `Phone: ${clientPhone}` : ""}
Date: ${today}

BUREAU: ${bureau}
${bureauAddress}

NEGATIVE ITEMS BEING DISPUTED:
${itemsList}

BUREAU'S RESPONSE LETTER:
${bureauResponseText}

Write a professional, legally precise follow-up dispute letter that:
1. References the bureau's specific response
2. Invokes the appropriate FCRA sections (§1681i, §1681s-2, etc.) based on their response
3. If they claimed the account is "verified", demand the Method of Verification under §1681i(a)(6)(B)
4. If they need more info, provide it clearly
5. If they deleted any items, acknowledge it and address remaining items
6. Demands correction or deletion within 30 days
7. Uses a firm but professional tone

Format as a complete, ready-to-mail letter with proper spacing. Use the client's real name and address at the top. Do not include placeholders — use the actual information provided.`;
  } else {
    // Initial dispute letter
    prompt = `You are a professional credit repair specialist. Write a formal credit dispute letter under the Fair Credit Reporting Act (FCRA).

CLIENT INFORMATION:
Name: ${clientName}
Address: ${clientAddress}
${clientEmail ? `Email: ${clientEmail}` : ""}
${clientPhone ? `Phone: ${clientPhone}` : ""}
Date: ${today}

BUREAU: ${bureau}
${bureauAddress}

NEGATIVE ITEMS TO DISPUTE:
${itemsList}

Write a professional, legally precise dispute letter that:
1. Clearly identifies each item being disputed with all relevant details
2. States the specific reason each item is being disputed (inaccurate, unverifiable, or incomplete)
3. Cites the appropriate FCRA sections (15 U.S.C. § 1681i, § 1681s-2, etc.)
4. Demands investigation and correction or deletion within 30 days
5. Requests written confirmation of the outcome
6. Uses a firm but professional tone

Format as a complete, ready-to-mail letter with proper spacing. Use the client's real name and address at the top. Do not include placeholders — use the actual information provided.`;
  }

  // Call Claude API
  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.json().catch(() => ({}));
    res.status(500).json({ error: err.error?.message || "Claude API error. Check your API key." });
    return;
  }

  const claudeData = await claudeRes.json();
  const letterText = claudeData.content?.[0]?.text || "";

  if (!letterText) {
    res.status(500).json({ error: "Empty response from Claude." });
    return;
  }

  res.status(200).json({ letter: letterText });
}
