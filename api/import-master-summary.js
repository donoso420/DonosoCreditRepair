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

  const { userId, pdfBase64 } = body || {};

  if (!userId) {
    res.status(400).json({ error: "userId is required." });
    return;
  }
  if (!pdfBase64) {
    res.status(400).json({ error: "pdfBase64 is required." });
    return;
  }

  const prompt = `You are a credit repair data extraction assistant. I am uploading a Credit Dispute Master Summary PDF.

Extract ALL negative items from the Priority Dispute Action List (Section 3) AND the Hard Inquiry Disputes (Section 4).

Return ONLY a valid JSON array. No explanation, no markdown, no code fences — just the raw JSON array.

Each item should have these exact fields:
- creditor: string (creditor/furnisher name, e.g. "MERCEDES-BENZ FINANCIAL")
- item_type: string — must be one of: "Collection", "Charge Off", "Late Payment", "Hard Inquiry", "Repossession", "Bankruptcy", "Foreclosure", "Judgment", "Lien", "Derogatory", "Negative Item"
- bureau: string — one of: "ALL_BUREAUS", "Experian", "Equifax", "TransUnion", "Equifax,TransUnion", "Experian,Equifax"
- account_reference: string (account number, e.g. "500113XXXXXXXX") or null
- balance: number or null (numeric value only, no $ sign)
- status: string (brief status like "Involuntary Repossession" or "Charge-Off")
- fcra_laws: string (all FCRA/FDCPA sections cited, e.g. "FCRA §1681i, §1681e(b), §1681s-2")
- dispute_issue: string (brief description of the dispute issue)
- recommended_action: string (brief recommended action)
- notes: string (any additional context worth noting) or null

For items that appear on specific bureau combinations (e.g. "Equifax & TransUnion ONLY"), set bureau to the comma-separated value like "Equifax,TransUnion".
For items on all 3 bureaus, set bureau to "ALL_BUREAUS".

Return only the JSON array, nothing else.`;

  // Call Claude API with the PDF document
  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.json().catch(() => ({}));
    res.status(500).json({ error: err.error?.message || "Claude API error." });
    return;
  }

  const claudeData = await claudeRes.json();
  const rawText = claudeData.content?.[0]?.text || "";

  let items;
  try {
    // Strip any accidental markdown fences
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    items = JSON.parse(cleaned);
    if (!Array.isArray(items)) throw new Error("Not an array");
  } catch {
    res.status(500).json({ error: "Could not parse items from PDF. Raw: " + rawText.slice(0, 200) });
    return;
  }

  // Expand multi-bureau items into individual rows
  const BUREAU_MAP = {
    ALL_BUREAUS: ["Experian", "Equifax", "TransUnion"],
    "Equifax,TransUnion": ["Equifax", "TransUnion"],
    "Experian,Equifax": ["Experian", "Equifax"],
    "Experian,TransUnion": ["Experian", "TransUnion"],
  };

  const rows = [];
  for (const item of items) {
    const bureaus = BUREAU_MAP[item.bureau] || [item.bureau || "Shared / Unknown"];
    for (const bureau of bureaus) {
      const creditor = String(item.creditor || "").trim();
      const itemType = String(item.item_type || "Negative Item").trim();
      const acctRef = String(item.account_reference || "").trim();
      const bureauNorm = bureau.trim();

      // Build fingerprint (same logic as frontend)
      const fp = [
        bureauNorm.toLowerCase(),
        creditor.toLowerCase(),
        itemType.toLowerCase(),
        acctRef.toLowerCase(),
      ]
        .join("|")
        .replace(/\s+/g, " ")
        .trim();

      rows.push({
        user_id: userId,
        bureau: bureauNorm,
        creditor,
        item_type: itemType,
        account_reference: acctRef || null,
        balance: item.balance != null && item.balance !== "" ? Number(item.balance) : null,
        status: String(item.status || "").trim() || null,
        fcra_laws: String(item.fcra_laws || "").trim() || null,
        dispute_issue: String(item.dispute_issue || "").trim() || null,
        recommended_action: String(item.recommended_action || "").trim() || null,
        notes: String(item.notes || "").trim() || null,
        is_active: true,
        source: "manual",
        verification_method: "manual",
        verification_notes: "Imported from Credit Dispute Master Summary PDF.",
        fingerprint: fp,
      });
    }
  }

  if (!rows.length) {
    res.status(200).json({ imported: 0, message: "No items found in PDF." });
    return;
  }

  // Upsert into Supabase
  const upsertRes = await fetch(
    `${supabaseUrl}/rest/v1/negative_items`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(rows),
    }
  );

  if (!upsertRes.ok) {
    const errText = await upsertRes.text().catch(() => "");
    res.status(500).json({ error: "Could not save items to database: " + errText.slice(0, 200) });
    return;
  }

  res.status(200).json({
    imported: rows.length,
    message: `Successfully imported ${rows.length} negative item rows from the PDF.`,
  });
}
