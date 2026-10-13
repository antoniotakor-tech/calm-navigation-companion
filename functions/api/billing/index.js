// POST /api/billing { session?, token?, action: "config" | "checkout" | "portal" | "notify", plan? }
//   config   → { enabled, prices } (public)
//   checkout → Stripe Checkout URL for Calm+ (monthly / yearly)
//   portal   → Stripe customer portal URL (change card, cancel)
//   notify   → "tell me when Calm+ launches" (works signed in or by device key)
import { ensureAuthTables, accountFromSession, ownerHashForDeviceToken, jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../auth/_store.js";
import { billingEnabled, stripe } from "./_stripe.js";

export const PRICES = { once: { label: "€2.99 once" } }; // pay once, yours forever

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const body = (await parseJsonBody(request)) || {};
  await ensureAuthTables(env.DB);
  const enabled = billingEnabled(env);
  const action = body.action || "config";

  if (action === "config") {
    return jsonResponse({ enabled, prices: PRICES });
  }

  if (action === "notify") {
    const a = await accountFromSession(env.DB, body.session);
    const who = a ? a.id : await ownerHashForDeviceToken(body.token);
    if (!who) return jsonError("Missing device key.", 400);
    await env.DB.prepare("INSERT OR IGNORE INTO plus_waitlist (who, created_at) VALUES (?, ?)").bind(who, Date.now()).run();
    return jsonResponse({ ok: true });
  }

  const a = await accountFromSession(env.DB, body.session);
  if (!a) return jsonError("Sign in with a passkey first, so Calm+ stays yours on every device.", 401);
  if (!enabled) return jsonError("Calm+ isn't open yet.", 501);
  const origin = new URL(request.url).origin;

  if (action === "checkout") {
    if (a.plan === "plus") return jsonError("You already have Calm+.", 409);
    const params = {
      mode: "payment",
      "line_items[0][price]": env.STRIPE_PRICE_ONCE,
      "line_items[0][quantity]": "1",
      client_reference_id: a.id,
      "payment_intent_data[metadata][account_id]": a.id,
      allow_promotion_codes: "true",
      success_url: `${origin}/?plus=success`,
      cancel_url: `${origin}/?plus=cancelled`,
    };
    if (a.stripe_customer) params.customer = a.stripe_customer;
    else params.customer_creation = "always";
    const s = await stripe(env, "checkout/sessions", params);
    return jsonResponse({ url: s.url });
  }

  if (action === "portal") {
    if (!a.stripe_customer) return jsonError("No Calm+ subscription on this account.", 404);
    const s = await stripe(env, "billing_portal/sessions", { customer: a.stripe_customer, return_url: origin + "/" });
    return jsonResponse({ url: s.url });
  }
  return jsonError("Unknown action.", 400);
}
