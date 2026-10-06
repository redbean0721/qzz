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
  --from-literal=REDIS_URL='redis://HOST:6379'

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
2. Delete the placeholder DNS record `AAAA qzz.tw 100::` first (the tunnel needs to create its own record for `qzz.tw`).
3. Public hostname: `qzz.tw`, path `^/v1/`, service `HTTP` → `qzz-api.qzz.svc.cluster.local:3001`.
   The path filter keeps everything else (e.g. `/health`) off the internet even if a Worker route is misconfigured.
4. Workers Routes on the `qzz.tw` zone must still have `qzz.tw/v1/*` → **None**, otherwise the Worker takes the request.

### 3. ArgoCD

```sh
kubectl apply -f deploy/argocd-app.yaml
```

ArgoCD then syncs `deploy/k8s` from `main` (auto-sync, prune, self-heal).
The `qzz` Namespace has `Prune=false` so the hand-made secrets are never deleted with it.

## How a release rolls out

1. A push to `main` touching the API builds `ghcr.io/redbean0721/qzz-api:sha-<commit>` (GitHub workflow).
2. The workflow commits the new tag into `k8s/deployment.yaml` (both the `migrate` init container and `api`).
3. ArgoCD syncs; each new Pod runs `node dist/migrate.js` (serialized with a Postgres advisory lock), then starts.
   Rolling update keeps the old Pods serving (`maxUnavailable: 0`); on shutdown the API drains on SIGTERM.

## Checks

```sh
kubectl -n qzz get pods
kubectl -n qzz logs deploy/qzz-api -c migrate
kubectl -n qzz logs deploy/cloudflared
curl -s -o /dev/null -w '%{http_code}\n' https://qzz.tw/v1/links/xxxxxxx   # 404 from the API = tunnel works
```
