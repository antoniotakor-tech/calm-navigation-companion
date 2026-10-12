import test from "node:test";
import assert from "node:assert/strict";
import { verifyStripeSignature, billingEnabled } from "./_stripe.js";
import * as webhook from "./webhook.js";
import { createFakeDb } from "../echoes/_testdb.mjs";

async function sign(payload, secret, t) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  return `t=${t},v1=` + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

test("Stripe signatures: valid passes; tampered, wrong secret or stale fail", async () => {
  const now = Date.now(), t = Math.floor(now / 1000), p = '{"a":1}';
  const h = await sign(p, "whsec_x", t);
  assert.equal(await verifyStripeSignature(p, h, "whsec_x", now), true);
  assert.equal(await verifyStripeSignature('{"a":2}', h, "whsec_x", now), false);
  assert.equal(await verifyStripeSignature(p, h, "whsec_y", now), false);
  assert.equal(await verifyStripeSignature(p, h, "whsec_x", now + 10 * 60 * 1000), false);
});

test("billing stays off until every Stripe secret exists", () => {
  assert.equal(billingEnabled({}), false);
  assert.equal(billingEnabled({ STRIPE_SECRET_KEY: "sk", STRIPE_WEBHOOK_SECRET: "wh", STRIPE_PRICE_ONCE: "price" }), true);
});

test("a forged webhook can't grant Calm+", async () => {
  const DB = createFakeDb();
  const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { client_reference_id: "acc", customer: "cus" } } });
  const res = await webhook.onRequestPost({ request: new Request("https://x/api/billing/webhook", { method: "POST", body, headers: { "stripe-signature": "t=1,v1=00" } }), env: { DB, STRIPE_WEBHOOK_SECRET: "whsec_x" } });
  assert.equal(res.status, 400);
  assert.ok(!DB.calls.some((c) => /UPDATE accounts/.test(c.sql)));
});

test("a signed subscription event upgrades the account until the period end", async () => {
  const DB = createFakeDb();
  const t = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ type: "customer.subscription.updated", data: { object: { status: "active", customer: "cus", current_period_end: t + 86400, metadata: { account_id: "acc" } } } });
  const res = await webhook.onRequestPost({ request: new Request("https://x/api/billing/webhook", { method: "POST", body, headers: { "stripe-signature": await sign(body, "whsec_x", t) } }), env: { DB, STRIPE_WEBHOOK_SECRET: "whsec_x" } });
  assert.equal(res.status, 200);
  const up = DB.calls.find((c) => /UPDATE accounts SET plan/.test(c.sql));
  assert.deepEqual(up.args, ["plus", (t + 86400) * 1000, "cus", "acc"]);
});

test("a paid one-time checkout grants Calm+ for good", async () => {
  const DB = createFakeDb();
  const t = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { client_reference_id: "acc", customer: "cus", payment_status: "paid" } } });
  const res = await webhook.onRequestPost({ request: new Request("https://x/api/billing/webhook", { method: "POST", body, headers: { "stripe-signature": await sign(body, "whsec_x", t) } }), env: { DB, STRIPE_WEBHOOK_SECRET: "whsec_x" } });
  assert.equal(res.status, 200);
  const up = DB.calls.find((c) => /plan = 'plus', plan_until = NULL/.test(c.sql));
  assert.deepEqual(up.args, ["cus", "acc"]);
});
