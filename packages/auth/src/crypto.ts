const PREFIX = "fgp_";

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function generateToken(): Promise<{
  plaintext: string;
  prefix: string;
  hash: string;
}> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const plaintext = `${PREFIX}${base64Url(bytes)}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, 16),
    hash: await hashToken(plaintext),
  };
}

export function tokenPrefix(token: string): string | null {
  if (!token.startsWith(PREFIX) || token.length < 16) return null;
  return token.slice(0, 16);
}

export async function signBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}
