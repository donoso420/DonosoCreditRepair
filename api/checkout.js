const STRIPE_API = "https://api.stripe.com/v1";

const PLANS = {
  foundation: { priceEnvKey: "STRIPE_PRICE_FOUNDATION" },
  dispute:    { priceEnvKey: "STRIPE_PRICE_DISPUTE" },
  rebuild:    { priceEnvKey: "STRIPE_PRICE_REBUILD" },
};

function requiredEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function createCheckoutSession({ secretKey, priceId, successUrl, cancelUrl }) {
  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  const response = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Stripe request failed (${response.status}): ${body}`);
  }

  return response.json();
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const plan = url.searchParams.get("plan");
  const planConfig = PLANS[plan];

  if (!planConfig) {
    res.status(400).send("Invalid plan.");
    return;
  }

  const secretKey = requiredEnv("STRIPE_SECRET_KEY");
  const priceId = requiredEnv(planConfig.priceEnvKey);
  const siteUrl = requiredEnv("SITE_URL") || "https://donosocreditrepair.com";

  if (!secretKey || !priceId) {
    res.status(500).send("Payment configuration is incomplete. Please contact us at 305-465-1919.");
    return;
  }

  try {
    const session = await createCheckoutSession({
      secretKey,
      priceId,
      successUrl: `${siteUrl}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${siteUrl}/#pricing`,
    });

    res.writeHead(303, { Location: session.url });
    res.end();
  } catch (error) {
    res.status(500).send("Could not start checkout. Please try again or call 305-465-1919.");
  }
}
