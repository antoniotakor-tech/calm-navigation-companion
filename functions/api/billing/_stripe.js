// Stripe over plain fetch (no SDK — nothing from node_modules is deployed).
// Configured with Pages secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
// STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY. Until they exist, Calm+ shows
// "coming soon" and people can ask to be notified (a fake-door test).
export function billingEnabled(env) {
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && (env.STRIPE_PRICE_MONTHLY || env.STRIPE_PRICE_YEARLY));
}

export async function stripe(env, path, params) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: params ? "POST" : "GET",
    headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded" },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || "Stripe error");
  return data;
}

/** Verifies the Stripe-Signature header (HMAC-SHA256 of "t.payload"), 5-minute tolerance. */
export async function verifyStripeSignature(payload, header, secret, now = Date.now()) {
  const parts = Object.fromEntries(String(header || "").split(",").map((kv) => kv.split("=").map((s) => s.trim())));
  const sigs = String(header || "").split(",").filter((kv) => kv.trim().startsWith("v1=")).map((kv) => kv.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}
