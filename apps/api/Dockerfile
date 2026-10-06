# syntax=docker/dockerfile:1
# Build（在 repo 根目錄）：docker build -f apps/api/Dockerfile .

# 建置階段固定跑在 build 機器的平台：產物是純 JS（正式依賴沒有原生模組），
# 所以 arm64 image 不需要經過 QEMU 模擬
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable

# 先只放 manifest 安裝依賴，程式碼變動時可以沿用這層快取
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn workspaces focus @qzz/api @qzz/shared

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN yarn workspace @qzz/shared build && yarn workspace @qzz/api build

# 換成只有正式依賴，再把要放進 image 的檔案整理到 /out（dist/ 和 drizzle/ 要在同一層）
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn workspaces focus @qzz/api --production
RUN mkdir -p /out/apps/api /out/packages/shared \
 && cp -a node_modules /out/ \
 && cp -a apps/api/package.json apps/api/dist apps/api/drizzle /out/apps/api/ \
 && cp -a packages/shared/package.json packages/shared/dist /out/packages/shared/ \
 && if [ -d apps/api/node_modules ]; then cp -a apps/api/node_modules /out/apps/api/; fi \
 && if [ -d packages/shared/node_modules ]; then cp -a packages/shared/node_modules /out/packages/shared/; fi
# 原生模組會是 build 機器平台的版本，跨平台 image 會壞掉：有的話直接讓 build 失敗
RUN if find /out -name '*.node' | grep .; then \
      echo 'native modules found: cross-platform build is unsafe' >&2; exit 1; \
    fi

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
WORKDIR /app/apps/api
# node 使用者是 uid 1000，對應 deploy/k8s/deployment.yaml 的 runAsUser
USER node
EXPOSE 3001
# 直接用 node 當 PID 1，SIGTERM 由 src/index.ts 處理
CMD ["node", "dist/index.js"]
