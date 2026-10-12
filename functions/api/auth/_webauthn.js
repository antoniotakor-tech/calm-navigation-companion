// Minimal, dependency-free WebAuthn (passkeys) verification for Cloudflare
// Functions, 2026-10-12. Uses only WebCrypto, so it runs on Workers and in
// `node --test` alike — the deploy copies no node_modules.
//
// Scope, on purpose:
//  - attestation "none" (we ask for it): we trust the key, not a device
//    vendor certificate chain — the same choice most passkey sites make.
//  - algorithms ES256 (-7, Apple/Google/1Password) and RS256 (-257, Windows Hello).
//  - every check from WebAuthn §7.1/§7.2 that matters without attestation:
//    type, challenge, origin, rpIdHash, user-present flag, user-verified flag
//    (we require Face ID / Touch ID / PIN), signature, and signCount rollback.

const enc = new TextEncoder();

export function b64urlEncode(bytes) {
  let s = "";
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function randomB64url(n = 32) { return b64urlEncode(crypto.getRandomValues(new Uint8Array(n))); }
export async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)); }
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// ---- tiny CBOR decoder (only what attestation objects / COSE keys use) ----
export function cborDecode(bytes) {
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function len(info) {
    if (info < 24) return info;
    if (info === 24) return bytes[pos++];
    if (info === 25) { const v = view.getUint16(pos); pos += 2; return v; }
    if (info === 26) { const v = view.getUint32(pos); pos += 4; return v; }
    if (info === 27) { const v = Number(view.getBigUint64(pos)); pos += 8; return v; }
    throw new Error("CBOR: unsupported length");
  }
  function item() {
    const first = bytes[pos++];
    const major = first >> 5, info = first & 31;
    switch (major) {
      case 0: return len(info);
      case 1: return -1 - len(info);
      case 2: { const n = len(info); const v = bytes.slice(pos, pos + n); pos += n; return v; }
      case 3: { const n = len(info); const v = new TextDecoder().decode(bytes.slice(pos, pos + n)); pos += n; return v; }
      case 4: { const n = len(info); const a = []; for (let i = 0; i < n; i++) a.push(item()); return a; }
      case 5: { const n = len(info); const m = new Map(); for (let i = 0; i < n; i++) { const k = item(); m.set(k, item()); } return m; }
      case 7: if (info === 20) return false; if (info === 21) return true; if (info === 22) return null;
      // fallthrough
      default: throw new Error("CBOR: unsupported item");
    }
  }
  const value = item();
  return { value, end: pos };
}

/** Parses authenticator data (WebAuthn §6.1). */
export function parseAuthData(ad) {
  if (ad.length < 37) throw new Error("authData too short");
  const flags = ad[32];
  const out = {
    rpIdHash: ad.slice(0, 32),
    up: !!(flags & 0x01), uv: !!(flags & 0x04), at: !!(flags & 0x40),
    signCount: new DataView(ad.buffer, ad.byteOffset + 33, 4).getUint32(0),
  };
  if (out.at) {
    let p = 37 + 16; // skip aaguid
    const idLen = (ad[p] << 8) | ad[p + 1];
    p += 2;
    out.credentialId = ad.slice(p, p + idLen);
    p += idLen;
    const { value, end } = cborDecode(ad.slice(p));
    out.coseKey = value;
    out.coseKeyEnd = p + end;
  }
  return out;
}

/** COSE key → { alg, jwk } for WebCrypto. */
export function coseToJwk(cose) {
  const alg = cose.get(3);
  if (alg === -7 && cose.get(1) === 2 && cose.get(-1) === 1) {
    return { alg, jwk: { kty: "EC", crv: "P-256", x: b64urlEncode(cose.get(-2)), y: b64urlEncode(cose.get(-3)), ext: true } };
  }
  if (alg === -257 && cose.get(1) === 3) {
    return { alg, jwk: { kty: "RSA", alg: "RS256", n: b64urlEncode(cose.get(-1)), e: b64urlEncode(cose.get(-2)), ext: true } };
  }
  throw new Error("Unsupported passkey algorithm");
}

/** DER ECDSA signature → raw r||s (64 bytes), which WebCrypto expects. */
export function derToRaw(der) {
  let p = 2;
  if (der[1] & 0x80) p = 2 + (der[1] & 0x7f);
  const read = () => {
    if (der[p++] !== 0x02) throw new Error("bad DER");
    const n = der[p++];
    let v = der.slice(p, p + n);
    p += n;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = read(), s = read();
  const raw = new Uint8Array(64);
  raw.set(r, 0); raw.set(s, 32);
  return raw;
}

function checkClientData(clientDataJSON, type, expectedChallenge, expectedOrigins) {
  const cd = JSON.parse(new TextDecoder().decode(clientDataJSON));
  if (cd.type !== type) throw new Error("Wrong ceremony type");
  if (cd.challenge !== expectedChallenge) throw new Error("Challenge mismatch");
  if (!expectedOrigins.includes(cd.origin)) throw new Error("Origin not allowed");
  return cd;
}

/**
 * Verifies navigator.credentials.create() output.
 * response: { id, response: { clientDataJSON, attestationObject } } (base64url strings)
 * Returns { credentialId (b64url), publicKeyJwk, alg, signCount }.
 */
export async function verifyRegistration({ credential, expectedChallenge, expectedOrigins, rpId }) {
  const clientDataJSON = b64urlDecode(credential.response.clientDataJSON);
  checkClientData(clientDataJSON, "webauthn.create", expectedChallenge, expectedOrigins);
  const att = cborDecode(b64urlDecode(credential.response.attestationObject)).value;
  const authData = att.get("authData");
  const ad = parseAuthData(authData);
  if (!equalBytes(ad.rpIdHash, await sha256(enc.encode(rpId)))) throw new Error("Wrong site");
  if (!ad.up) throw new Error("User not present");
  if (!ad.uv) throw new Error("Face ID / Touch ID / PIN is required");
  if (!ad.credentialId) throw new Error("No credential in response");
  const { alg, jwk } = coseToJwk(ad.coseKey);
  // Make sure WebCrypto accepts the key now, not at first sign-in.
  await importKey(alg, jwk);
  return { credentialId: b64urlEncode(ad.credentialId), publicKeyJwk: jwk, alg, signCount: ad.signCount };
}

function importKey(alg, jwk) {
  return alg === -7
    ? crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
    : crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

/**
 * Verifies navigator.credentials.get() output against a stored passkey.
 * stored: { alg, publicKeyJwk, signCount }. Returns { newSignCount }.
 */
export async function verifyAuthentication({ credential, stored, expectedChallenge, expectedOrigins, rpId }) {
  const clientDataJSON = b64urlDecode(credential.response.clientDataJSON);
  checkClientData(clientDataJSON, "webauthn.get", expectedChallenge, expectedOrigins);
  const authData = b64urlDecode(credential.response.authenticatorData);
  const ad = parseAuthData(authData);
  if (!equalBytes(ad.rpIdHash, await sha256(enc.encode(rpId)))) throw new Error("Wrong site");
  if (!ad.up) throw new Error("User not present");
  if (!ad.uv) throw new Error("Face ID / Touch ID / PIN is required");
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0);
  signed.set(await sha256(clientDataJSON), authData.length);
  let sig = b64urlDecode(credential.response.signature);
  const key = await importKey(stored.alg, stored.publicKeyJwk);
  let ok;
  if (stored.alg === -7) ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(sig), signed);
  else ok = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, sig, signed);
  if (!ok) throw new Error("Signature check failed");
  // Synced passkeys (iCloud Keychain) always report 0; only enforce when counting.
  if ((ad.signCount || stored.signCount) && ad.signCount <= stored.signCount) throw new Error("Passkey counter went backwards");
  return { newSignCount: ad.signCount };
}
