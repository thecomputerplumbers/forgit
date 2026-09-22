const SECRET =
  /(?:fgp_[A-Za-z0-9_-]{8,}|whsec_[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]{8,}|token\s+[A-Za-z0-9._~+/-]{8,})/g;

export function redact(value: string): string {
  return value.replace(SECRET, "[redacted]");
}

export function requestIdFrom(headers: Headers): string {
  const incoming = headers.get("x-request-id");
  if (incoming && /^[A-Za-z0-9_.:-]{8,80}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

export type LogFields = Record<string, string | number | boolean | null>;

export function logEvent(event: string, fields: LogFields): void {
  const safe: LogFields = { event };
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = typeof value === "string" ? redact(value) : value;
  }
  console.log(JSON.stringify({ time: new Date().toISOString(), ...safe }));
}
