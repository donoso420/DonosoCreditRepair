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

  // Fetch client profile — non-fatal, use fallbacks if missing
  let profile = {};
  try {
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/client_profiles?user_id=eq.${userId}&select=full_name,phone,address,contact_email`,
      { headers }
    );
    if (profileRes.ok) {
      const profiles = await profileRes.json();
      profile = profiles[0] || {};
    }
  } catch (_) {
    // proceed with empty profile
  }

  // Fetch selected negative items — try with new columns first, fall back if not migrated
  const idsParam = negativeItemIds.map((id) => `id.eq.${id}`).join(",");
  let negativeItems = [];
  for (const selectCols of [
    "id,creditor,item_type,bureau,balance,account_reference,status,notes,fcra_laws,dispute_issue,recommended_action",
    "id,creditor,item_type,bureau,balance,account_reference,status,notes",
  ]) {
    const itemsRes = await fetch(
      `${supabaseUrl}/rest/v1/negative_items?user_id=eq.${userId}&or=(${idsParam})&select=${selectCols}`,
      { headers }
    );
    if (itemsRes.ok) {
      negativeItems = await itemsRes.json();
      break;
    }
  }
  if (!negativeItems.length) {
    res.status(404).json({ error: "No matching negative items found. Make sure items are selected and saved." });
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

  const isCreditorDirect = bureau === "Creditor Direct";

  // For creditor direct, pull the creditor name from the first selected item
  const primaryCreditor = negativeItems[0]?.creditor || "Creditor";
  const creditorAddress = isCreditorDirect
    ? `${primaryCreditor}\n[See recommended action for mailing address]`
    : (bureauAddresses[bureau] || `${bureau}\n[Bureau Address]`);

  const itemsList = negativeItems
    .map((item, i) => {
      const parts = [`ITEM ${i + 1}: ${item.creditor} — ${item.item_type}`];
      if (item.account_reference) parts.push(`Account: ${item.account_reference}`);
      if (item.balance) parts.push(`Balance: $${Number(item.balance).toFixed(2)}`);
      if (item.status) parts.push(`Status: ${item.status}`);
      if (item.fcra_laws) parts.push(`Legal Basis: ${item.fcra_laws}`);
      if (item.dispute_issue) parts.push(`Dispute Issue: ${item.dispute_issue}`);
      if (item.recommended_action) parts.push(`Recommended Action: ${item.recommended_action}`);
      if (item.notes) parts.push(`Notes: ${item.notes}`);
      return parts.join(", ");
    })
    .join("\n");

  let prompt;

  if (isCreditorDirect) {
    // Creditor / furnisher direct dispute letter
    prompt = `You are a professional credit repair specialist. Write a formal dispute letter sent directly to the creditor or furnisher under the Fair Credit Reporting Act (FCRA) and Fair Debt Collection Practices Act (FDCPA) where applicable.

CLIENT INFORMATION:
Name: ${clientName}
Address: ${clientAddress}
${clientEmail ? `Email: ${clientEmail}` : ""}
${clientPhone ? `Phone: ${clientPhone}` : ""}
Date: ${today}

RECIPIENT: ${primaryCreditor}
NOTE: Insert the creditor's mailing address from the recommended action notes below.

ACCOUNTS IN DISPUTE:
${itemsList}

Write a professional, firm furnisher dispute letter that:
1. Identifies the client and the specific account(s) being disputed
2. Clearly states the exact dispute issue for each account (inaccurate, re-aging, wrong balance, not mine, double-reported, etc.)
3. Cites FCRA §1681s-2(b) requiring furnishers to investigate and correct inaccurate information
4. If a collection account, also invokes FDCPA §1692g demanding debt validation and proof of right to collect
5. If re-aging is cited, specifically demands the original Date of First Delinquency (DOFD)
6. If balance inflation is cited, demands an itemized breakdown of the balance
7. Demands written confirmation of any corrections within 30 days
8. States that failure to correct will result in a complaint to the CFPB and applicable state attorney general
9. Uses a firm, professional, legally precise tone — this is going to the furnisher, not a bureau

Format as a complete, ready-to-mail letter. Use the client's real name and address at the top. Do not use placeholders for the client's information — use actual data provided. Leave a placeholder for the creditor's specific mailing address.`;

  } else if (bureauResponseText) {
    // Follow-up letter responding to bureau's response
    prompt = `You are a professional credit repair specialist. Write a formal follow-up dispute letter based on the bureau's response.

CLIENT INFORMATION:
Name: ${clientName}
Address: ${clientAddress}
${clientEmail ? `Email: ${clientEmail}` : ""}
${clientPhone ? `Phone: ${clientPhone}` : ""}
Date: ${today}

BUREAU: ${bureau}
${creditorAddress}

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
    // Initial bureau dispute letter
    prompt = `You are a professional credit repair specialist. Write a formal credit dispute letter under the Fair Credit Reporting Act (FCRA).

CLIENT INFORMATION:
Name: ${clientName}
Address: ${clientAddress}
${clientEmail ? `Email: ${clientEmail}` : ""}
${clientPhone ? `Phone: ${clientPhone}` : ""}
Date: ${today}

BUREAU: ${bureau}
${creditorAddress}

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
