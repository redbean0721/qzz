# Deploy

```
qzz.tw/v1/*  → Cloudflare → Tunnel → cloudflared (k3s) → qzz-api Service → API Pods
qzz.tw/*     → Cloudflare Worker (Nuxt, deployed by Workers Builds)
```

- `k8s/` — synced by ArgoCD: namespace, API Deployment + Service, cloudflared
- `argocd-app.yaml` — the ArgoCD Application (applied once by hand)
- Postgres and Valkey are external to these manifests; the API reaches them through `DATABASE_URL` / `REDIS_URL`
- Secrets are created by hand with `kubectl` and are never committed

## First-time setup

### 1. Namespace and secrets

```sh
kubectl apply -f deploy/k8s/namespace.yaml

# API: connection strings for the existing Postgres / Valkey
kubectl -n qzz create secret generic qzz-api \
  --from-literal=DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/qzz' \
  --from-literal=REDIS_URL='redis://HOST:6379' \
  --from-literal=SAFE_BROWSING_API_KEY='<Google API key restricted to the Safe Browsing API>'

# Cloudflare Tunnel token (step 2)
kubectl -n qzz create secret generic cloudflared \
  --from-literal=token='<TUNNEL_TOKEN>'
```

Only if the GHCR package `qzz-api` is private (a public package needs nothing):

```sh
kubectl -n qzz create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username=<github user> \
  --docker-password=<PAT with read:packages>
```

and uncomment `imagePullSecrets` in `k8s/deployment.yaml`.

To change a value later, re-run the command with `--dry-run=client -o yaml | kubectl apply -f -`
and restart the Deployment (`kubectl -n qzz rollout restart deploy/qzz-api`).

### 2. Cloudflare Tunnel

Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create a tunnel (cloudflared):

1. Copy the token from the install command into the `cloudflared` secret above.
2. `qzz.tw` must have no other DNS record: delete any placeholder (`AAAA qzz.tw 100::`), and make sure the
   `qzz-web` Worker is attached by **Route only — never as a Custom Domain**. A Custom Domain creates a
   Workers-managed DNS record ("a DNS record managed by Workers already exists on that host" when adding the
   tunnel route) and sends *every* path to the Worker, ignoring Workers Routes.
3. Published application route (public hostname): `qzz.tw`, path `^/v1/`, service `HTTP` →
   `qzz-api.qzz.svc.cluster.local:3001`. This creates the proxied Tunnel DNS record for `qzz.tw`.
   The path filter keeps everything else (e.g. `/health`) off the internet even if a Worker route is misconfigured.
4. Zone `qzz.tw` → Workers Routes (add it from the zone page, not from the Worker's own settings, so "None" is
   selectable) must list:

   | Route          | Worker                       |
   |----------------|------------------------------|
   | `qzz.tw/v1/*`  | None ("Workers disabled")    |
   | `qzz.tw/*`     | `qzz-web` (from wrangler.jsonc) |

   Quick check: `curl https://qzz.tw/v1/links/xxxxxxx` must return the API's `{"error":"not found"}`;
   a Nuxt-style `"Page not found: /v1/..."` means the Worker still takes `/v1/*`.

### 3. ArgoCD

```sh
kubectl apply -f deploy/argocd-app.yaml
```

ArgoCD then syncs `deploy/k8s` from `main` (auto-sync, prune, self-heal).
The `qzz` Namespace has `Prune=false` so the hand-made secrets are never deleted with it.

### 4. GitHub

- Repository secret `GPG_PRIVATE_KEY`: the deploy bot's armored private key (no passphrase; if it has one, also add
  `GPG_PASSPHRASE` and uncomment it in the workflow). Add the public key to the GitHub account that owns
  `deploy@redbean0721.com` so the bot's commits show as Verified.
- After the first workflow run creates the `qzz-api` package: GitHub → Packages → qzz-api → Package settings →
  change visibility to **Public** (or keep it private and use the `ghcr-pull` secret from step 1).

## How a release rolls out

`.github/workflows/api.yml`, on a push to `main` that touches the API, shared code, lockfile or the workflow:

1. **test** — typecheck, migrate and the API test suite against Postgres 18 + Valkey 8 service containers.
2. **build** — `apps/api/Dockerfile` for `linux/amd64` and `linux/arm64`, pushed as
   `ghcr.io/redbean0721/qzz-api:sha-<7 chars>` and `:main`. The build stage runs on the runner's platform and the
   final stage only copies files, so arm64 needs no QEMU (the build fails if a native `.node` module ever appears).
3. **deploy** — rewrites both image fields in `k8s/deployment.yaml` to the new sha tag and pushes a GPG-signed
   commit `deploy: <original subject>` as "Redbean0721 Deploy Bot". `deploy/` isn't in the workflow's path
   filter, so this commit doesn't trigger another run.
4. ArgoCD syncs; each new Pod runs `node dist/migrate.js` (serialized with a Postgres advisory lock), then starts.
   Rolling update keeps the old Pods serving (`maxUnavailable: 0`); on shutdown the API drains on SIGTERM.

Rollback: revert the `deploy:` commit (or edit the tag back) and push; ArgoCD syncs the older image.

## Takedown

Disabled links / pastes return 404 everywhere immediately (the row is kept for the record):

```sh
kubectl -n qzz exec deploy/qzz-api -- node dist/admin.js show    https://qzz.tw/abc1234
kubectl -n qzz exec deploy/qzz-api -- node dist/admin.js disable https://qzz.tw/abc1234
kubectl -n qzz exec deploy/qzz-api -- node dist/admin.js disable https://qzz.tw/p/abc1234
kubectl -n qzz exec deploy/qzz-api -- node dist/admin.js enable  link abc1234
```

`show` prints the target URL (or a paste preview), creator IP and timestamps.

## Checks

```sh
kubectl -n qzz get pods
kubectl -n qzz logs deploy/qzz-api -c migrate
kubectl -n qzz logs deploy/cloudflared
curl -s -o /dev/null -w '%{http_code}\n' https://qzz.tw/v1/links/xxxxxxx   # 404 from the API = tunnel works
```
