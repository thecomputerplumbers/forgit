import { AuthShell } from "@/components/shell";

export default function NotFound() {
  return (
    <AuthShell>
      <div className="auth-card">
        <h1>Page not found</h1>
        <p>That repository, ref, or page is not on this instance, or you don't have access.</p>
        <a className="btn btn-primary btn-block" href="/">
          Back to repositories
        </a>
      </div>
    </AuthShell>
  );
}
