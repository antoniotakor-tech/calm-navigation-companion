// POST /api/billing/webhook — Stripe → us. The ONLY place a plan changes, and
// only after the signature checks out, so nobody can grant themselves Calm+.
import { ensureAuthTables, jsonError, jsonResponse, requireDb } from "../auth/_store.js";
import { verifyStripeSignature } from "./_stripe.js";

const ACTIVE = new Set(["active", "trialing", "past_due"]); // past_due: Stripe is still retrying the card

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  if (!env.STRIPE_WEBHOOK_SECRET) return jsonError("Billing not configured.", 501);
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET))) return jsonError("Bad signature.", 400);
  await ensureAuthTables(env.DB);
  const event = JSON.parse(payload);
  const obj = event.data && event.data.object;

  if (event.type === "checkout.session.completed" && obj.client_reference_id) {
    await env.DB.prepare("UPDATE accounts SET stripe_customer = ?, plan = 'plus' WHERE id = ?").bind(obj.customer, obj.client_reference_id).run();
  }
  if (/^customer\.subscription\.(created|updated|deleted)$/.test(event.type)) {
    const accountId = obj.metadata && obj.metadata.account_id;
    const live = event.type !== "customer.subscription.deleted" && ACTIVE.has(obj.status);
    const until = obj.current_period_end ? obj.current_period_end * 1000 : (obj.items && obj.items.data && obj.items.data[0] && obj.items.data[0].current_period_end ? obj.items.data[0].current_period_end * 1000 : null);
    const sql = `UPDATE accounts SET plan = ?, plan_until = ?, stripe_customer = COALESCE(stripe_customer, ?) WHERE ${accountId ? "id = ?" : "stripe_customer = ?"}`;
    await env.DB.prepare(sql).bind(live ? "plus" : "free", live ? until : null, obj.customer, accountId || obj.customer).run();
  }
  return jsonResponse({ received: true });
}
