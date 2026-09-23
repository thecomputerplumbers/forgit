import { createRepositoryAction } from "@/app/actions";
import { Icon } from "@/components/icons";
import { Shell } from "@/components/shell";
import { Alert, Box, Field, PageHeader } from "@/components/ui";
import { requireOrganization } from "@/lib/session";

export const metadata = { title: "New repository" };

export default async function NewRepositoryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { user, organization } = await requireOrganization();
  const { error } = await searchParams;
  return (
    <Shell organization={organization} user={user}>
      <div className="container container-narrow page">
        <PageHeader
          description="A repository holds your project's files and its full revision history."
          title="Create a new repository"
        />
        <Box>
          <form action={createRepositoryAction} className="form">
            {error ? <Alert title="Could not create the repository">{error}</Alert> : null}
            <Field hint="Letters, numbers, dots, dashes, and underscores." label="Repository name">
              <div className="input-prefix">
                <span>{organization.slug} /</span>
                <input
                  autoComplete="off"
                  autoFocus
                  name="name"
                  pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,99}"
                  placeholder="my-project"
                  required
                  spellCheck={false}
                />
              </div>
            </Field>
            <Field
              label={
                <>
                  Description <span className="optional">(optional)</span>
                </>
              }
            >
              <input name="description" placeholder="A short summary of the project" />
            </Field>
            <fieldset>
              <legend>Visibility</legend>
              <div className="choice-grid">
                <label className="choice">
                  <input defaultChecked name="visibility" type="radio" value="private" />
                  <div>
                    <strong>
                      <Icon name="lock" /> Private
                    </strong>
                    <span>Only organization admins and people you add can see it.</span>
                  </div>
                </label>
                <label className="choice">
                  <input name="visibility" type="radio" value="public" />
                  <div>
                    <strong>
                      <Icon name="globe" /> Public
                    </strong>
                    <span>Anyone can read and clone it. Only people you add can push.</span>
                  </div>
                </label>
              </div>
            </fieldset>
            <hr />
            <div className="form-actions">
              <button className="btn btn-primary" data-confetti type="submit">
                Create repository
              </button>
              <a className="btn btn-ghost" href="/">
                Cancel
              </a>
            </div>
          </form>
        </Box>
      </div>
    </Shell>
  );
}
