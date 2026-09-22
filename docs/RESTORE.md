# Restore

Two stores, two backups.

## D1

Metadata: users, organizations, repositories, pull requests, tokens (hashes only), checks, webhooks, audit.

```sh
wrangler d1 export forgit --remote --output forgit-metadata.sql
```

Restore into an empty database with `wrangler d1 execute forgit --remote --file forgit-metadata.sql`, then deploy the worker that points at it.

Token plaintext cannot be restored. People create new tokens. Webhook signing secrets are in this export; treat the file as a secret.

## R2

Git objects, refs, packs, and LFS objects are the bucket `forgit-git`, under walgit's `repos/` prefix. Enable bucket versioning if you want point-in-time recovery. A restore is a copy of that bucket into a new bucket, with `services/git/walgit.toml` aimed at it.

The container disk `/var/lib/walgit` is cache. Do not back it up. After a restore, any new container pointed at the bucket serves the repositories.

## Order

Restore R2 first, then D1, then start the worker. Repository rows point at backing ids that must already exist in the bucket. A repository row without objects still lists in the UI and fails on clone until someone pushes.

## Prove it

1. Push a known commit.
2. Export D1 and copy the bucket (or note the object versions).
3. Delete the container instance.
4. Clone again. The known commit must still be there.
