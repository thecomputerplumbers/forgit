"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
export function RunRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [active, router]);
  return <span className="muted">{active ? "Updates every 5 seconds" : "Run complete"}</span>;
}
export function StepLog({ url, active }: { url: string; active: boolean }) {
  const [text, setText] = useState("Loading log…");
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        setText(
          response.ok
            ? await response.text()
            : response.status === 410
              ? "Log expired"
              : "Log not available yet",
        );
      } catch (error) {
        if (!controller.signal.aborted)
          setText(error instanceof Error ? error.message : "Could not load log");
      }
    };
    void load();
    const timer = active ? setInterval(() => void load(), 4000) : undefined;
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [url, active]);
  return (
    <pre
      style={{
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        maxHeight: 560,
        overflow: "auto",
        padding: 16,
        background: "var(--bg-subtle)",
        fontSize: 12,
      }}
    >
      {text}
    </pre>
  );
}
