// Signed, expiring claim tokens for passwordless case access.
// Format: base64url(caseId) . base64url(expUnix) . base64url(hmacSha256(secret, "caseId.exp"))
// v1 has no user accounts; whoever holds the link owns the case view.

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sign(secret: string, caseId: string, exp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64urlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${caseId}.${exp}`))));
}

export async function createClaimToken(caseId: string, secret: string, ttlSeconds: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await sign(secret, caseId, exp);
  return `${b64urlEncode(enc.encode(caseId))}.${b64urlEncode(enc.encode(String(exp)))}.${sig}`;
}

/** Returns the caseId when the token is valid for that case, else null. */
export async function verifyClaimToken(
  token: string,
  caseId: string,
  secret: string,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [cidB64, expB64, sig] = parts as [string, string, string];
  let decodedId: string;
  let exp: number;
  try {
    decodedId = new TextDecoder().decode(b64urlDecode(cidB64));
    exp = Number.parseInt(new TextDecoder().decode(b64urlDecode(expB64)), 10);
  } catch {
    return false;
  }
  if (decodedId !== caseId) return false;
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = await sign(secret, caseId, exp);
  // Constant-time comparison to avoid timing side-channels.
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
