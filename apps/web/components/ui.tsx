import type { ReactNode } from "react";

import { formatDate, hue, initials, timeAgo } from "@/lib/format";
import { animalFor } from "@/lib/themes";

import { Icon, type IconName } from "./icons";

export function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.42)),
        ["--avatar-hue" as string]: hue(name),
      }}
    >
      <span className="avatar-initials">{initials(name)}</span>
      {/* Shown instead of initials by the Field Guide theme. */}
      <span className="avatar-animal">{animalFor(name)}</span>
    </span>
  );
}

export function TimeAgo({ value }: { value: number | string }) {
  const millis = typeof value === "number" ? value : Date.parse(value);
  if (Number.isNaN(millis)) return null;
  return (
    <time dateTime={new Date(millis).toISOString()} title={formatDate(millis)}>
      {timeAgo(millis)}
    </time>
  );
}

export type Tone = "neutral" | "accent" | "success" | "danger" | "warning" | "done";

export function Badge({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

export function Alert({
  tone = "danger",
  title,
  children,
}: {
  tone?: "danger" | "warning" | "info" | "success";
  title?: string;
  children?: ReactNode;
}) {
  const icon: IconName = tone === "success" ? "checkCircle" : tone === "info" ? "info" : "alert";
  return (
    <div className={`alert alert-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={icon} />
      <div>
        {title ? <strong>{title}</strong> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function Box({
  title,
  description,
  actions,
  tone,
  children,
  id,
  flush,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: "danger";
  children: ReactNode;
  id?: string;
  flush?: boolean;
}) {
  return (
    <section className={`box${tone ? ` box-${tone}` : ""}`} id={id}>
      {title || actions ? (
        <header className="box-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="box-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? "box-body flush" : "box-body"}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Sha({ sha, href }: { sha: string; href?: string }) {
  const short = sha.slice(0, 7);
  return href ? (
    <a className="sha-chip" href={href} title={sha}>
      {short}
    </a>
  ) : (
    <code className="sha-chip" title={sha}>
      {short}
    </code>
  );
}
