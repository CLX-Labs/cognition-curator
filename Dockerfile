FROM node:24-bookworm-slim
WORKDIR /app

# Runtime uses the locked TypeScript workspace packages, with tsx for Node execution.
# Copy manifests separately so source-only changes reuse the dependency layer.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/scheduler/package.json packages/scheduler/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ai/package.json packages/ai/package.json
# npm ci can retain unselected workspace transitives from the shared lock.
# With no mobile manifest in this image, prune removes that unused graph.
RUN npm ci --omit=dev --workspace @recollect/api --workspace @recollect/worker --include-workspace-root \
    && npm prune --omit=dev
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages packages
COPY scripts/start-backend.mjs scripts/start-backend.mjs
USER node
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "scripts/start-backend.mjs"]
