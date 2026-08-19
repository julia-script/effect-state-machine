FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile --filter @effect-state-machine/bugs-and-patches...
RUN pnpm --filter @effect-state-machine/bugs-and-patches build:server

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV BUGS_PATCHES_HOST=0.0.0.0
ENV BUGS_PATCHES_PORT=4788
ENV BUGS_PATCHES_UI_ROOT=

WORKDIR /workspace
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/bugs-and-patches/node_modules ./apps/bugs-and-patches/node_modules
COPY --from=build /workspace/apps/bugs-and-patches/package.json ./apps/bugs-and-patches/package.json
COPY --from=build /workspace/apps/bugs-and-patches/dist/server ./apps/bugs-and-patches/dist/server

WORKDIR /workspace/apps/bugs-and-patches
EXPOSE 4788
CMD ["node", "dist/server/main.js"]
