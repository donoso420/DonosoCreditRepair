import { createOpenAIResponse, extractOutputText, getLetterModel, getOpenAiKey } from "./_openai.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openAiKey = getOpenAiKey();
  const openAiModel = getLetterModel();

  if (!supabaseUrl || !serviceRoleKey || !openAiKey) {
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

  // Fetch client profile — try with all columns, fall back if some columns missing
  let profile = {};
  const profileColumnSets = [
    "full_name,address,ssn_last4,date_of_birth",
    "full_name,address,ssn_last4",
    "full_name,address",
    "full_name",
  ];
  for (const cols of profileColumnSets) {
    try {
      const profileRes = await fetch(
        `${supabaseUrl}/rest/v1/client_profiles?user_id=eq.${userId}&select=${cols}&limit=1`,
        { headers }
      );
      if (profileRes.ok) {
        const profiles = await profileRes.json();
        const row = profiles[0] || {};
        if (row.full_name) { profile = row; break; }
      }
    } catch (e) {
      console.error("Profile fetch error:", e.message);
    }
  }

  // If profile still missing name, return a clear error
  if (!profile.full_name) {
    res.status(400).json({ error: "Client profile not found. Open this client in the admin panel, go to Contact Info, and make sure their full name is saved." });
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
  const clientSsnLast4 = profile.ssn_last4 ? `Social Security No. (Last 4 Digits): ${profile.ssn_last4}` : "Social Security No. (Last 4 Digits): [LAST 4]";
  const clientDob = profile.date_of_birth ? `Date of Birth: ${new Date(profile.date_of_birth).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}` : "";

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

  // Client header block — matches your sample letter format exactly
  const clientHeader = `${clientName}
${clientAddress}
${clientDob}
${clientSsnLast4}`;

  let prompt;

  if (isCreditorDirect) {
    prompt = `You are an experienced credit repair specialist. Write a formal dispute letter sent directly to the creditor/furnisher. Follow the EXACT format below. No markdown. No asterisks. No bold symbols. No pound signs. No special characters of any kind.

Write the complete letter now using this exact structure:

${clientHeader}

${today}

${primaryCreditor}
[INSERT CREDITOR MAILING ADDRESS]

Re: Formal Notice of Dispute and Demand for Correction — ${primaryCreditor} Account #[Account Number]
FCRA 15 U.S.C. § 1681s-2(b) | FDCPA 15 U.S.C. § 1692g

To Whom It May Concern:

[Opening paragraph: state you are formally disputing the accuracy and validity of the account(s) below and that as a furnisher, the recipient is legally required under FCRA § 1681s-2(b) to investigate and correct inaccurate information upon notice of dispute.]

Account in Dispute:

Creditor: [name]
Account Number: [number]
Account Type: [type]
Reported Balance: [balance]
Dispute Issue: [exact issue from data]

Basis for This Dispute:

[One detailed paragraph per account. Cite the exact FCRA or FDCPA section that applies to the specific issue. If collection: demand written debt validation under FDCPA § 1692g including proof of original creditor, original balance, DOFD, and chain of ownership. If re-aging: demand original Date of First Delinquency in writing. If wrong balance: demand full itemized statement. Be specific — use the actual account name, number, and dispute issue from the data provided.]

My demands are as follows:

1. Investigate this dispute and provide written verification of every data element reported, including account status, payment history, balance, and all remarks.
2. Provide written confirmation of the investigation results within 30 days of receipt of this letter, including the name of the person contacted and documentation reviewed — this is my right under FCRA § 1681s-2(b).
3. If you cannot fully verify every element of this account within 30 days, correct or delete the inaccurate information immediately.
4. Failure to respond will result in formal complaints filed with the Consumer Financial Protection Bureau, the Federal Trade Commission, and the applicable state attorney general. I reserve the right to pursue statutory damages under FCRA § 1681n and FDCPA § 1692k.

Please treat this letter as a formal written dispute. I expect a written response within thirty (30) days of receipt.

Do not contact me by telephone. All communications must be in writing.

Respectfully,


${clientName}
Consumer — Pro Se

Enclosures: Copy of Government-Issued Photo ID · Proof of Current Address
Sent Via: USPS Certified Mail, Return Receipt Requested

ACCOUNT DATA (use this to fill in the letter above — do not include this section in the letter):
${itemsList}`;

  } else if (bureauResponseText) {
    prompt = `You are an experienced credit repair specialist. Write a formal escalation dispute letter to ${bureau}. Follow the EXACT format below. No markdown. No asterisks. No bold symbols. No pound signs. No special characters of any kind.

Write the complete letter now using this exact structure:

${clientHeader}

${today}

${creditorAddress}

Re: Escalation of Unresolved Dispute — [Creditor name(s)] Account(s) — [Account Number(s)]
FCRA 15 U.S.C. § 1681i(a)(6)(B)(iii) | § 1681i(a)(5) | § 1681e(b)

To Whom It May Concern:

[Opening paragraph: reference the prior dispute and the bureau's response. State specifically what they said and why it is legally insufficient. If they said "verified" without proof, call that out. If the remark says "Dispute resolved; customer disagrees," state that is not a resolution and you are escalating.]

Account in Dispute:

Creditor: [name]
Account Number: [number]
Bureau Response: [what the bureau said]
Why It Is Insufficient: [specific legal reason]

Basis for This Escalation:

[One dedicated paragraph per item. If the bureau said "verified": invoke FCRA § 1681i(a)(6)(B) and demand full Method of Verification — name of person contacted, date of contact, and documentation reviewed. If they ignored an item: re-dispute and flag it as unaddressed. Be specific — cite the exact account, account number, and applicable law.]

My demands are as follows:

1. Conduct a new, substantive reinvestigation of each account listed above — not a repeat of the prior rubber-stamp result.
2. Provide in writing the full Method of Verification used — including the name of the individual at the furnisher contacted, the date of contact, and every document reviewed. This is my right under FCRA § 1681i(a)(6)(B)(iii).
3. If any account cannot be fully verified within 30 days, delete it from my credit report under § 1681i(a)(5)(A).
4. If this dispute is not resolved in my favor, include my statement of dispute in all future credit reports furnished to third parties under § 1681i(b) and § 1681i(c).
5. File formal complaints with the Consumer Financial Protection Bureau and the Federal Trade Commission if not resolved. I reserve the right to pursue statutory damages under FCRA § 1681n for willful noncompliance.

Please treat this letter as a formal written escalation under the FCRA. I expect a written response within thirty (30) days of receipt.

Do not contact me by telephone. All communications must be in writing.

Respectfully,


${clientName}
Consumer — Pro Se

Enclosures: Copy of Government-Issued Photo ID · Proof of Current Address
Sent Via: USPS Certified Mail, Return Receipt Requested

ACCOUNT DATA (use this to fill in the letter above — do not include this section in the letter):
ITEMS: ${itemsList}
BUREAU RESPONSE: ${bureauResponseText}`;

  } else {
    prompt = `You are an experienced credit repair specialist. Write a formal initial dispute letter to ${bureau}. Follow the EXACT format below. No markdown. No asterisks. No bold symbols. No pound signs. No special characters of any kind.

Write the complete letter now using this exact structure:

${clientHeader}

${today}

${creditorAddress}

Re: Formal Dispute of Inaccurate Credit Information — [List creditor names and account numbers]
FCRA 15 U.S.C. § 1681i | § 1681e(b) | § 1681s-2

To Whom It May Concern:

[Opening paragraph: state that under the Fair Credit Reporting Act, 15 U.S.C. § 1681i, you are formally disputing the accuracy and completeness of the items listed below and demanding a thorough reinvestigation. State that ${bureau} has a legal obligation to investigate, correct, or delete unverifiable information within 30 days.]

[For each disputed item, write a section in this exact format:]

Account in Dispute:

Creditor: [name]
Account Number: [number]
Account Type: [type]
Reported Balance: [balance]
Dispute Issue: [exact issue from the data]

[Dedicated paragraph explaining exactly why this item is being disputed. Cite the specific FCRA section that applies to this issue — § 1681c for reporting period violations, § 1681e(b) for accuracy, § 1681i for reinvestigation, § 1681s-2 for furnisher duties. Demand ${bureau} obtain actual verified documentation from the furnisher — not a rubber-stamp response. State exactly what correction or deletion is demanded. Be specific — use the actual account name, number, balance, and dispute issue from the data.]

[Repeat the Account in Dispute section for each additional account.]

My demands are as follows:

1. Conduct a thorough reinvestigation of each account listed above and obtain verified documentation from each furnisher — not a confirmation that they were contacted.
2. Provide written results of the investigation within 30 days of receipt of this letter (or 45 days if this dispute was triggered by the annual free credit report).
3. Provide a free updated copy of my credit report reflecting all corrections upon completion of the investigation.
4. If any item cannot be fully verified, delete it from my credit report immediately under § 1681i(a)(5)(A).
5. Failure to investigate or respond constitutes a willful violation of the FCRA. I will file a formal complaint with the Consumer Financial Protection Bureau and pursue statutory damages under § 1681n ($100 to $1,000 per violation, per item) if this matter is not resolved.

Please treat this letter as a formal written dispute under the Fair Credit Reporting Act. I expect a written response within thirty (30) days of receipt of this letter.

Do not contact me by telephone. All communications must be in writing.

Respectfully,


${clientName}
Consumer — Pro Se

Enclosures: Copy of Government-Issued Photo ID · Proof of Current Address
Sent Via: USPS Certified Mail, Return Receipt Requested

ACCOUNT DATA (use this to fill in the letter above — do not include this section in the letter):
${itemsList}`;
  }

  let letterText = "";
  try {
    const openAiData = await createOpenAIResponse({
      apiKey: openAiKey,
      model: openAiModel,
      input: prompt,
      maxOutputTokens: 5000,
    });
    letterText = extractOutputText(openAiData);
  } catch (error) {
    res.status(500).json({ error: error.message || "OpenAI API error. Check your API key." });
    return;
  }

  if (!letterText) {
    res.status(500).json({ error: "Empty response from OpenAI." });
    return;
  }

  res.status(200).json({ letter: letterText });
}
