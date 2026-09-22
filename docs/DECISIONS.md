# Decisions

These close the open questions in the original plan for the first release of forgit.

1. The product name is **forgit**.
2. walgit is the Git server. The worker does not reimplement pack storage. Tree, blob, commit, and ref reads use walgit's JSON API. Squash merge, compare, branch creation, and single-file writes run `git` in the container helper, then push through walgit. The helper refuses to impersonate `svc:forgit-merge` except on the merge route.
3. One shared container serves the single tenant. Nginx on the container port streams Git bytes to walgit with buffering disabled. `/_forgit/` is not routed by the public worker.
4. Cold start is accepted. The container sleeps after 60 minutes. Repository bytes remain in R2.
5. Concurrent pushes are walgit's manifest compare-and-swap. Merge uses `git push --force-with-lease` on the expected base SHA, then a D1 update that matches the expected head SHA.
6. Supported `gh` commands are listed in `docs/GH_COMPAT.md`. GraphQL covers `createPullRequest`, `mergePullRequest`, and `addPullRequestReview`.
7. Repositories are created through the app or the REST API. Push-to-create is off.
8. The only merge strategy is squash.
9. Review comments are file-level, with an optional line. They are not GitHub diff positions.
10. Issues stay out of version 1.
11. MCP and `gh` authenticate with personal access tokens (`Authorization: Bearer`, `token`, or HTTP Basic). Browser sessions use Better Auth. Device flow is later.
12. Checks are recorded through the API and gate merges. A CI runner is not in this release. The check rows are tied to a commit SHA so a later runner can fill them in.
13. Quotas are operational: walgit cache budget 8 GiB, D1 for metadata, R2 for Git. No automatic CI-minute quota until a runner exists.
14. Restore is export of D1 plus the R2 bucket. See `docs/RESTORE.md`.
