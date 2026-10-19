# Rebuild the API from compiled, tested artifacts without reinstalling the
# monorepo dependency graph. Build context: repository root.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

COPY packages/database/dist/ /repo/packages/database/dist/
COPY apps/api/dist/ /repo/apps/api/dist/

RUN rm -rf \
      /repo/node_modules/.pnpm/better-sqlite3@* \
      /repo/node_modules/.pnpm/@types+better-sqlite3@* \
      /repo/node_modules/better-sqlite3 \
      /repo/packages/database/node_modules/better-sqlite3
