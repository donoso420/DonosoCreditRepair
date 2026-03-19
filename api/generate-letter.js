export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
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

  // Fetch client profile — required for name/address on letter
  let profile = {};
  try {
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/client_profiles?user_id=eq.${userId}&select=full_name,phone,address,contact_email&limit=1`,
      { headers }
    );
    if (profileRes.ok) {
      const profiles = await profileRes.json();
      profile = profiles[0] || {};
    } else {
      const errText = await profileRes.text();
      console.error("Profile fetch failed:", profileRes.status, errText);
    }
  } catch (e) {
    console.error("Profile fetch error:", e.message);
  }

  // If profile is still missing critical info, return a clear error
  if (!profile.full_name) {
    res.status(400).json({ error: "Client profile not found. Make sure the client has a name saved in Contact Info." });
    return;
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
    prompt = `You are an aggressive, experienced credit repair attorney's assistant. Write a powerful, legally forceful dispute letter sent DIRECTLY to the creditor/furnisher. This letter must feel personal, specific, and legally threatening — not generic.

${clientName.toUpperCase()}
${clientAddress}
${clientPhone ? clientPhone : ""}
${clientEmail ? clientEmail : ""}

${today}

${primaryCreditor}
[INSERT CREDITOR MAILING ADDRESS]

RE: FORMAL NOTICE OF DISPUTE AND DEMAND FOR CORRECTION — FCRA §1681s-2(b) / FDCPA §1692g

ACCOUNTS IN DISPUTE:
${itemsList}

LETTER REQUIREMENTS — follow every one of these:

OPENING: Address the specific account(s) by name and account number. State clearly that you are disputing the accuracy and/or validity of this information and that the furnisher is legally required to investigate under FCRA §1681s-2(b).

FOR EACH ITEM: Write a dedicated paragraph that:
- Names the exact account, account number, and reported balance
- Cites the specific dispute issue from the data above (don't be vague — reference the exact problem: re-aging, wrong balance, not mine, duplicate reporting, lack of verification, etc.)
- Invokes the specific FCRA or FDCPA section that applies to that exact issue
- If it's a collection account: demand written debt validation under FDCPA §1692g including proof of original creditor, original balance, date of first delinquency, and chain of ownership
- If there is re-aging: demand the original Date of First Delinquency (DOFD) in writing
- If balance is inflated: demand a full itemized account statement

DEMANDS SECTION: After addressing all items, include a bold demands section that:
- Demands written confirmation of investigation results within 30 days
- States that failure to respond will be treated as an admission that the information is inaccurate
- Warns that non-compliance will result in complaints filed with the CFPB, FTC, and the state attorney general
- States the client reserves the right to pursue statutory damages under FCRA §1681n ($100–$1,000 per violation) and FDCPA §1692k

CLOSING: Professional but firm. No apologies, no hedging. The tone should make clear this client knows their rights and will enforce them.

FORMAT: Use clean letter format with proper spacing. Real name and address at top. Bold section headers. No placeholders for client info — use the actual data provided. Leave [INSERT CREDITOR MAILING ADDRESS] as a placeholder only.`;

  } else if (bureauResponseText) {
    // Follow-up letter responding to bureau's response
    prompt = `You are an aggressive, experienced credit repair attorney's assistant. Write a powerful follow-up dispute letter to ${bureau} based on their response. This is NOT a first dispute — the bureau has already responded and the client is escalating. The tone must be firm, legally precise, and make clear that inaction will have consequences.

${clientName.toUpperCase()}
${clientAddress}
${clientPhone ? clientPhone : ""}
${clientEmail ? clientEmail : ""}

${today}

${bureau}
${creditorAddress}

RE: FOLLOW-UP DISPUTE — DEMAND FOR METHOD OF VERIFICATION / ESCALATED DISPUTE

ITEMS IN DISPUTE:
${itemsList}

BUREAU'S RESPONSE:
${bureauResponseText}

LETTER REQUIREMENTS — follow every one:

OPENING: Reference the prior dispute and the bureau's response. Be specific about what they said and why it is insufficient or legally inadequate.

FOR EACH ITEM THE BUREAU RESPONDED TO:
- If they said "verified": Invoke FCRA §1681i(a)(6)(B) and demand the FULL Method of Verification — specifically the name, address, and phone number of each person contacted, and every document reviewed. State that simply saying "verified" without providing proof is a violation of the FCRA.
- If they deleted an item: Acknowledge it and move on to remaining items.
- If they said they need more info: Provide exactly what they asked for and re-assert the dispute.
- If they ignored an item entirely: Flag it as unaddressed and re-dispute it forcefully.

ESCALATION SECTION: Include a section stating:
- This is the client's final request before escalating to regulatory complaints
- Complaints will be filed with the CFPB and the FTC if not resolved within 15 days
- The client reserves the right to pursue willful noncompliance damages under FCRA §1681n

FORMAT: Clean letter format, bold headers for each section, real client info at top, no generic filler. Every paragraph must reference something specific — the bureau's actual response, the specific account name, the specific law. No boilerplate.`;

  } else {
    // Initial bureau dispute letter
    prompt = `You are an aggressive, experienced credit repair attorney's assistant. Write a powerful, specific, legally forceful initial dispute letter to ${bureau}. This letter must feel tailored to THIS client's exact situation — not a template. Use the client's real information and the exact dispute issues provided.

${clientName.toUpperCase()}
${clientAddress}
${clientPhone ? clientPhone : ""}
${clientEmail ? clientEmail : ""}

${today}

${bureau}
${creditorAddress}

RE: FORMAL DISPUTE OF INACCURATE CREDIT INFORMATION — FCRA §1681i

ITEMS BEING DISPUTED:
${itemsList}

LETTER REQUIREMENTS — follow every one of these:

OPENING: Address ${bureau} directly. State that under the Fair Credit Reporting Act, 15 U.S.C. §1681i, the client is formally disputing the accuracy and completeness of the items listed below and demanding a thorough reinvestigation. Reference that ${bureau} has a legal obligation to investigate, correct, or delete unverifiable information within 30 days.

FOR EACH ITEM: Write a dedicated, specific paragraph that:
- Names the exact creditor, account number, and reported balance
- States the specific dispute reason from the data (don't be vague — use the actual dispute issue: re-aging, incorrect balance, not the client's account, duplicate entry, unverifiable, etc.)
- Cites the precise FCRA section that applies to that specific issue (e.g., §1681c for reporting period violations, §1681e(b) for accuracy requirements, §1681i for reinvestigation obligations, §1681s-2 for furnisher duties)
- Demands that ${bureau} contact the furnisher and obtain actual verification — not just a rubber-stamp "verified" response
- States what outcome is demanded: correction or deletion

DEMAND SECTION: After all items, include a bold section that:
- Demands written results of the investigation within 30 days (or 45 days if triggered by annual credit report)
- Demands a free updated copy of the credit report showing the corrections
- States that failure to investigate or respond constitutes a willful violation of the FCRA
- Warns that the client will file a CFPB complaint and pursue statutory damages under §1681n ($100–$1,000 per violation per item) if not resolved

CLOSING: Firm and professional. No apologies. The client knows their rights.

FORMAT: Use proper business letter format. Client's full name and address at the top left. Bold headers for each disputed item. Clean spacing between sections. Every sentence must serve a purpose — no filler, no generic language, no placeholders for client info. Use the actual data provided above.`;
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
