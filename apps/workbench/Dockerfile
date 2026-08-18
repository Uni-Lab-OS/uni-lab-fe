# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV UNILAB_CONTAINER_BUILD=1
RUN corepack enable

WORKDIR /workspace
COPY . .

RUN --mount=type=cache,id=unilab-workbench-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile --ignore-scripts \
    && pnpm --filter @unilab/workbench build:production

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      openssh-client \
      tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV THEIA_WORKSPACE=/workspace
ENV UNILAB_AGENT_ENABLED=0

WORKDIR /opt/unilab-workbench
COPY --from=build /workspace/apps/workbench/lib ./lib
COPY --from=build /workspace/apps/workbench/plugins ./plugins
COPY --from=build /workspace/apps/workbench/package.json ./package.json

RUN chown -R node:node /opt/unilab-workbench /home/node

USER node
EXPOSE 3100

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3100/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "lib/backend/main.js", "/workspace", "--hostname", "0.0.0.0", "--port", "3100", "--plugins=local-dir:/opt/unilab-workbench/plugins"]
