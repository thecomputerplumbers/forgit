# gh compatibility

forgit implements the calls these commands make. It does not implement GitHub Enterprise.

Set:

```sh
export GH_HOST=git.thecomputerplumbers.com
export GH_ENTERPRISE_TOKEN=fgp_...
gh config set git_protocol https --host git.thecomputerplumbers.com
```

`gh auth login` is not implemented. The token environment variable is the supported login.

| Command                  | Supported | Notes                                                                               |
| ------------------------ | --------- | ----------------------------------------------------------------------------------- |
| `gh auth status`         | yes       | Bearer token against `GET /api/v3/user`                                             |
| `gh repo view`           | yes       |                                                                                     |
| `gh repo create`         | yes       | `POST /orgs/{org}/repos` or `POST /user/repos` into the caller's first organization |
| `gh repo clone`          | yes       | HTTPS only                                                                          |
| `gh pr create`           | yes       | GraphQL `createPullRequest`. Repository node id is `forgit:repo:{owner}/{name}`     |
| `gh pr list`             | yes       |                                                                                     |
| `gh pr view`             | yes       |                                                                                     |
| `gh pr diff`             | yes       |                                                                                     |
| `gh pr checkout`         | yes       | Normal git fetch of the head ref                                                    |
| `gh pr review --approve` | yes       |                                                                                     |
| `gh pr merge --squash`   | yes       | Other merge methods return 422                                                      |
| selected `gh api`        | yes       | Routes listed below                                                                 |
| `gh issue`               | no        |                                                                                     |
| `gh run` / `gh workflow` | no        | Check runs can be posted, but there is no Actions runner                            |

## REST

```text
GET    /api/v3/user
GET    /api/v3/user/repos
GET    /api/v3/repos/{owner}/{repo}
POST   /api/v3/orgs/{org}/repos
POST   /api/v3/user/repos
GET    /api/v3/repos/{owner}/{repo}/contents/{path}
GET    /api/v3/repos/{owner}/{repo}/branches
GET    /api/v3/repos/{owner}/{repo}/commits
GET    /api/v3/repos/{owner}/{repo}/pulls
POST   /api/v3/repos/{owner}/{repo}/pulls
GET    /api/v3/repos/{owner}/{repo}/pulls/{number}
PATCH  /api/v3/repos/{owner}/{repo}/pulls/{number}
GET    /api/v3/repos/{owner}/{repo}/pulls/{number}/files
POST   /api/v3/repos/{owner}/{repo}/pulls/{number}/reviews
PUT    /api/v3/repos/{owner}/{repo}/pulls/{number}/merge
POST   /api/v3/repos/{owner}/{repo}/commits/{sha}/check-runs
POST   /api/v3/repos/{owner}/{repo}/hooks
```

## GraphQL

`createPullRequest`, `addPullRequestReview`, `mergePullRequest`.

Node ids:

```text
forgit:repo:{owner}/{name}
forgit:pr:{owner}/{name}/{number}
```

## MCP

`POST /mcp` with the same bearer token. Tools: `get_me`, `get_file_contents`, `create_or_update_file`, `list_branches`, `create_branch`, `list_pull_requests`, `pull_request_read`, `create_pull_request`, `update_pull_request`, `merge_pull_request`, `pull_request_review_write`.

`create_or_update_file` pushes as the token's user. It cannot update a protected default branch. That push is rejected by walgit.

## Proof

`pnpm test` exercises the REST, GraphQL, and MCP handlers in-process. `tests/gh/run.sh` drives an unmodified `gh` against a live host when `GH_HOST` and `GH_ENTERPRISE_TOKEN` are set. Pin the `gh` version you care about in that environment; the suite does not vendor a binary.
