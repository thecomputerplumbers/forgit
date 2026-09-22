import { ForgeError } from "./types.ts";

export function assertWebhookUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ForgeError("Webhook URL is invalid", 422, "webhook");
  }
  if (url.protocol !== "https:") {
    throw new ForgeError("Webhook URL must use https", 422, "webhook");
  }
  if (url.username || url.password) {
    throw new ForgeError("Webhook URL must not include credentials", 422, "webhook");
  }
  const host = url.hostname.replaceAll("[", "").replaceAll("]", "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    isPrivateAddress(host)
  ) {
    throw new ForgeError("Webhook URL must be a public host", 422, "webhook");
  }
}

function isPrivateAddress(host: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if ([a, b, Number(v4[3]), Number(v4[4])].some((part) => part > 255)) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const v6 = host.toLowerCase();
  return v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}
