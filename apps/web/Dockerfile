# Web image: builds the static Kanban board and serves it via nginx, which also
# reverse-proxies /api and /health to the orchestrator (same-origin, so the app
# works from any device on the network without per-host rebuilds).
FROM node:22-slim AS build

WORKDIR /app

ENV NX_DAEMON=false \
    CI=true

COPY . .

RUN npm install --no-audit --no-fund
# Same-origin API path; nginx proxies it to the orchestrator.
RUN VITE_API_URL=/api npx nx build @orion/web

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
