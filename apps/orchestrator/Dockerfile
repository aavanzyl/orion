FROM node:22-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NX_DAEMON=false \
    CI=true

COPY package.json package-lock.json nx.json .npmrc ./
COPY apps/orchestrator/package.json ./apps/orchestrator/
COPY apps/web/package.json ./apps/web/
COPY packages/adapters/board/core/package.json ./packages/adapters/board/core/
COPY packages/adapters/board/github/package.json ./packages/adapters/board/github/
COPY packages/adapters/board/jira/package.json ./packages/adapters/board/jira/
COPY packages/adapters/board/linear/package.json ./packages/adapters/board/linear/
COPY packages/adapters/board/native/package.json ./packages/adapters/board/native/
COPY packages/adapters/board/trello/package.json ./packages/adapters/board/trello/
COPY packages/adapters/communication/core/package.json ./packages/adapters/communication/core/
COPY packages/adapters/communication/webhook/package.json ./packages/adapters/communication/webhook/
COPY packages/adapters/harness/claude/package.json ./packages/adapters/harness/claude/
COPY packages/adapters/harness/codex/package.json ./packages/adapters/harness/codex/
COPY packages/adapters/harness/core/package.json ./packages/adapters/harness/core/
COPY packages/adapters/scm/core/package.json ./packages/adapters/scm/core/
COPY packages/adapters/scm/github/package.json ./packages/adapters/scm/github/
COPY packages/core/config/package.json ./packages/core/config/
COPY packages/core/graph/package.json ./packages/core/graph/
COPY packages/core/rag/package.json ./packages/core/rag/
COPY packages/core/workflow-engine/package.json ./packages/core/workflow-engine/
COPY packages/data/db/package.json ./packages/data/db/
COPY packages/shared/adapter-kit/package.json ./packages/shared/adapter-kit/
COPY packages/shared/models/package.json ./packages/shared/models/

RUN npm install --no-audit --no-fund

COPY . .

RUN npx nx build @orion/orchestrator

RUN groupadd -r orion && useradd -r -g orion -m -d /data -s /bin/bash orion \
  && chown -R orion:orion /data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3333

EXPOSE 3333

USER orion

CMD ["node", "apps/orchestrator/dist/main.mjs"]
