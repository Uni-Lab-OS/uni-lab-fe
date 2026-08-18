FROM node:22-alpine AS build

WORKDIR /workspace
RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:web

FROM nginx:1.27-alpine

ENV UNILAB_BACKEND_ORIGIN=http://host.docker.internal:8080

COPY deploy/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /workspace/apps/kernel-web/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
