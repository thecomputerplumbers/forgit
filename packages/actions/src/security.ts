import { ForgeError } from "@forgit/domain";
import { safeEqual, signBody } from "@forgit/auth/crypto";
import { RefEventsSchema, type RefEvent } from "./types.ts";

export async function verifyEvent(
  body: string,
  signature: string | null,
  secret: string | undefined,
): Promise<RefEvent[]> {
  if (!secret || !signature || !safeEqual(signature, await signBody(secret, body)))
    throw new ForgeError("Invalid event signature", 401, "signature");
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new ForgeError("Invalid event JSON", 400, "event");
  }
  const parsed = RefEventsSchema.safeParse(value);
  if (!parsed.success) throw new ForgeError("Invalid ref event batch", 400, "event");
  return parsed.data;
}
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const decode = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
async function key(value: string | undefined) {
  if (!value || !/^[0-9a-f]{64}$/i.test(value))
    throw new ForgeError("Actions encryption key is not configured", 503, "configuration");
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(value.match(/../g)!, (v) => parseInt(v, 16)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptSecret(
  value: string,
  master: string | undefined,
  context: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    await key(master),
    new TextEncoder().encode(value),
  );
  return JSON.stringify({ v: 1, iv: encode(iv), data: encode(new Uint8Array(encrypted)) });
}
export async function decryptSecret(
  value: string,
  master: string | undefined,
  context: string,
): Promise<string> {
  const envelope = JSON.parse(value);
  if (envelope.v !== 1) throw new Error("Unsupported secret version");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(envelope.iv),
        additionalData: new TextEncoder().encode(context),
      },
      await key(master),
      decode(envelope.data),
    ),
  );
}
export function mask(value: string, secrets: string[]): string {
  let text = value;
  for (const secret of [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length))
    text = text.replaceAll(secret, "[REDACTED]");
  return text.replace(/\bfg[pmt]_[A-Za-z0-9_-]+\b/g, "[REDACTED]");
}
export function safeRepairPath(path: string): boolean {
  return (
    !!path &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((p) => p === ".." || p.startsWith(".")) &&
    !/(^|\/)(tests?|__tests__|fixtures|node_modules|vendor|dist|build|coverage)(\/|$)/i.test(
      path,
    ) &&
    !/(^|\/)(AGENTS\.md|package\.json|.*lock.*|.*config.*|.*\.(test|spec)\.[^/]+|Dockerfile|Makefile|Cargo\.toml|pyproject\.toml)$/i.test(
      path,
    )
  );
}
