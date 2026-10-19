# Rebuild chat-agent with migration-only PostgreSQL session storage.
# Build context: repository root.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

COPY apps/chat-agent/dist/ /repo/apps/chat-agent/dist/

RUN rm -rf \
      /repo/node_modules/.pnpm/better-sqlite3@* \
      /repo/node_modules/.pnpm/@types+better-sqlite3@* \
      /repo/node_modules/better-sqlite3 \
      /repo/packages/database/node_modules/better-sqlite3
