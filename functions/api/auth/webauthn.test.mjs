import test from "node:test";
import assert from "node:assert/strict";
import * as W from "./_webauthn.js";

// ---- a software "authenticator" that behaves like an iPhone passkey ----
function cbor(v) {
  const head = (major, n) => n < 24 ? [major << 5 | n] : n < 256 ? [major << 5 | 24, n] : [major << 5 | 25, n >> 8, n & 255];
  if (typeof v === "number") return Uint8Array.from(v >= 0 ? head(0, v) : head(1, -1 - v));
  if (typeof v === "string") { const b = new TextEncoder().encode(v); return Uint8Array.from([...head(3, b.length), ...b]); }
  if (v instanceof Uint8Array) return Uint8Array.from([...head(2, v.length), ...v]);
  if (v instanceof Map) { const parts = [Uint8Array.from(head(5, v.size))]; for (const [k, x] of v) parts.push(cbor(k), cbor(x)); return concat(...parts); }
  throw new Error("enc");
}
function concat(...a) { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { out.set(x, p); p += x.length; } return out; }
function rawToDer(raw) {
  const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = concat(Uint8Array.of(0), b); return concat(Uint8Array.of(2, b.length), b); };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}
const RP = "calm-navigation-companion.pages.dev", ORIGIN = "https://" + RP;
const cd = (type, challenge, origin = ORIGIN) => new TextEncoder().encode(JSON.stringify({ type, challenge, origin }));

async function makeDevice() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const credId = crypto.getRandomValues(new Uint8Array(16));
  const rpHash = await W.sha256(new TextEncoder().encode(RP));
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, W.b64urlDecode(jwk.x)], [-3, W.b64urlDecode(jwk.y)]]);
  return {
    async create(challenge, flags = 0x45) {
      const authData = concat(rpHash, Uint8Array.of(flags, 0, 0, 0, 0), new Uint8Array(16), Uint8Array.of(0, 16), credId, cbor(cose));
      const att = cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return { id: W.b64urlEncode(credId), response: { clientDataJSON: W.b64urlEncode(cd("webauthn.create", challenge)), attestationObject: W.b64urlEncode(att) } };
    },
    async get(challenge, { origin, flags = 0x05, count = 0 } = {}) {
      const authData = concat(rpHash, Uint8Array.of(flags, 0, 0, 0, count));
      const client = cd("webauthn.get", challenge, origin);
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, concat(authData, await W.sha256(client))));
      return { id: W.b64urlEncode(credId), response: { clientDataJSON: W.b64urlEncode(client), authenticatorData: W.b64urlEncode(authData), signature: W.b64urlEncode(rawToDer(sig)) } };
    },
  };
}

test("a passkey registers and then signs in", async () => {
  const dev = await makeDevice();
  const reg = await W.verifyRegistration({ credential: await dev.create("c1"), expectedChallenge: "c1", expectedOrigins: [ORIGIN], rpId: RP });
  assert.equal(reg.alg, -7);
  const auth = await W.verifyAuthentication({ credential: await dev.get("c2"), stored: reg, expectedChallenge: "c2", expectedOrigins: [ORIGIN], rpId: RP });
  assert.equal(auth.newSignCount, 0);
});

test("wrong challenge, wrong origin, or no Face ID are refused", async () => {
  const dev = await makeDevice();
  const reg = await W.verifyRegistration({ credential: await dev.create("c1"), expectedChallenge: "c1", expectedOrigins: [ORIGIN], rpId: RP });
  const opts = { stored: reg, expectedOrigins: [ORIGIN], rpId: RP };
  await assert.rejects(W.verifyAuthentication({ ...opts, credential: await dev.get("other"), expectedChallenge: "c2" }), /Challenge/);
  await assert.rejects(W.verifyAuthentication({ ...opts, credential: await dev.get("c2", { origin: "https://evil.example" }), expectedChallenge: "c2" }), /Origin/);
  await assert.rejects(W.verifyAuthentication({ ...opts, credential: await dev.get("c2", { flags: 0x01 }), expectedChallenge: "c2" }), /Face ID/);
  await assert.rejects(W.verifyRegistration({ credential: await dev.create("c1", 0x41), expectedChallenge: "c1", expectedOrigins: [ORIGIN], rpId: RP }), /Face ID/);
});

test("a signature from a different key is refused", async () => {
  const a = await makeDevice(), b = await makeDevice();
  const reg = await W.verifyRegistration({ credential: await a.create("c1"), expectedChallenge: "c1", expectedOrigins: [ORIGIN], rpId: RP });
  await assert.rejects(W.verifyAuthentication({ credential: await b.get("c2"), stored: reg, expectedChallenge: "c2", expectedOrigins: [ORIGIN], rpId: RP }), /Signature/);
});

test("a counter that goes backwards is refused (cloned authenticator)", async () => {
  const dev = await makeDevice();
  const reg = await W.verifyRegistration({ credential: await dev.create("c1"), expectedChallenge: "c1", expectedOrigins: [ORIGIN], rpId: RP });
  const stored = { ...reg, signCount: 5 };
  await assert.rejects(W.verifyAuthentication({ credential: await dev.get("c2", { count: 3 }), stored, expectedChallenge: "c2", expectedOrigins: [ORIGIN], rpId: RP }), /counter/);
  const ok = await W.verifyAuthentication({ credential: await dev.get("c3", { count: 6 }), stored, expectedChallenge: "c3", expectedOrigins: [ORIGIN], rpId: RP });
  assert.equal(ok.newSignCount, 6);
});
