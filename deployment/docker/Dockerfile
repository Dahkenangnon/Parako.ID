# syntax=docker/dockerfile:1.8

ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

FROM ${NODE_IMAGE} AS build
ENV HUSKY=0 \
    MONGOMS_DISABLE_POSTINSTALL=1 \
    NODE_ENV=development \
    PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
WORKDIR /build

RUN apt-get update \
    && apt-get install --yes --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts prisma.config.pg.ts ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build \
    && pnpm prune --prod --ignore-scripts

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PARAKO_ROOT=/app \
    PARAKO_ENV_FILE=/app/runtime/.env
WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 parako \
    && useradd --uid 10001 --gid 10001 --no-create-home \
      --home-dir /app --shell /usr/sbin/nologin parako

COPY --from=build --chown=10001:10001 /build/package.json /build/pnpm-lock.yaml /build/pnpm-workspace.yaml ./
COPY --from=build --chown=10001:10001 /build/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /build/dist ./dist
COPY --from=build --chown=10001:10001 /build/public ./public
COPY --from=build --chown=10001:10001 /build/prisma ./prisma
COPY --from=build --chown=10001:10001 /build/prisma.config.ts /build/prisma.config.pg.ts ./
COPY --from=build --chown=10001:10001 /build/runtime/locales ./runtime/locales
RUN install --directory --owner=10001 --group=10001 --mode=0755 /app/runtime/views

USER 10001:10001
EXPOSE 9007
VOLUME ["/app/runtime"]

CMD ["node", "dist/src/index.js"]
