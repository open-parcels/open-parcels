# syntax=docker/dockerfile:1.10
#
# One image for amd64 and arm64 (the Home Assistant Pi is aarch64). Two targets:
#   (default)          the server with the web UI at / (all-in-one)
#   --target server    the server only, for a web UI hosted elsewhere (decision record 0004)
# Debian slim rather than Alpine: native modules ship glibc builds.

ARG NODE_VERSION=26
# The node:26-slim index (amd64 + arm64) by digest, so a moved tag never changes the build. Bump:
# `docker buildx imagetools inspect node:26-slim`, copy the Digest line here.
ARG NODE_DIGEST=sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5
# Tailscale is not in the image: the entrypoint downloads the pinned, hash-checked release into the
# data folder the first time it is switched on (TS_STATE_DIR; docker/tailscale-entrypoint.sh).

# --- Build: compile TypeScript with the full toolchain -------------------------------------------
FROM node:${NODE_VERSION}-slim@${NODE_DIGEST} AS build
# Compilers for better-sqlite3 when no prebuilt binary matches this Node ABI and architecture.
RUN apt-get update \
 && apt-get install --no-install-recommends -y python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY server/package.json server/
COPY web/package.json web/
# The shared rules ship as a vendored, integrity-pinned tarball (no install scripts), the built-in
# providers as the pinned open-parcels-providers release, laid out by the root postinstall.
COPY server/vendor/ server/vendor/
COPY server/src/tools/providers.ts server/src/tools/
RUN npm ci --workspace server --workspace web --include-workspace-root
COPY server/ server/
# Again after the sources: a context with a local provider layout never reaches the image.
RUN npm run providers
RUN npm run build --workspace server

# --- Bundle: the server and its tools as ESM bundles, plus only the native modules ---------------
FROM build AS bundle-server
RUN cd server && node dist/tools/bundle.js /out \
 && cp package.json /out/server/package.json
# The bundled layout must start: a missing native module or a misplaced file fails the build here.
# The second start runs the providers in the sandbox: the server refuses to start unless the
# bundled child comes up under the permission model and its guest serves every built-in provider.
RUN cd /out && node --input-type=module \
    -e "await import('sharp'); const { default: Db } = await import('better-sqlite3'); new Db(':memory:').close()" \
 && node /app/server/dist/tools/smoke.js /out/server/dist/main.js \
 && OPENPARCELS_PROVIDER_ISOLATION=pool node /app/server/dist/tools/smoke.js /out/server/dist/main.js

# The web UI: a static build the server serves at / (the API client is generated and committed).
FROM bundle-server AS bundle
COPY web/ /app/web/
RUN npm run build --workspace web \
 && mkdir -p /out/web && cp -r /app/web/dist /out/web/dist

# --- Runtime ------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim@${NODE_DIGEST} AS runtime-base
# The commit the image is built from (op-publish passes it); shown on the Status page next to the
# version. Declared in the last stage only, so a new commit never invalidates the build cache.
ARG OPENPARCELS_COMMIT=""
# npm, npx and corepack are not needed at run time (−17 MB).
RUN apt-get update \
 && apt-get install --no-install-recommends -y tini \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && mkdir -p /data /var/lib/tailscale \
 && chown node:node /data /var/lib/tailscale
WORKDIR /app
COPY --chmod=755 docker/tailscale-entrypoint.sh /usr/local/bin/tailscale-entrypoint.sh

ENV NODE_ENV=production \
    OPENPARCELS_COMMIT=${OPENPARCELS_COMMIT} \
    OPENPARCELS_DATA_DIR=/data \
    OPENPARCELS_PORT=3000

# Runs as the image's unprivileged `node` user (uid 1000). The application files are owned by root
# and read-only for it; /data is the only place it writes (the on-demand Tailscale too), plus
# /var/lib/tailscale for Tailscale's state (a named volume mounted there inherits the ownership).
USER node
VOLUME ["/data"]
EXPOSE 3000

# Probes the address the server listens on; a wildcard (the default) is reached on loopback.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "const h=process.env.OPENPARCELS_HOST||'';const a=['','0.0.0.0','::'].includes(h)?'127.0.0.1':h.includes(':')?'['+h+']':h;fetch('http://'+a+':'+(process.env.OPENPARCELS_PORT||3000)+'/api/v1/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# The entrypoint starts Tailscale first when TS_STATE_DIR is set, then execs the server; without it,
# it only execs the server.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/tailscale-entrypoint.sh"]
CMD ["node", "server/dist/main.js"]

LABEL org.opencontainers.image.title="open-parcels" \
      org.opencontainers.image.description="Self-hosted parcel and order tracking for every carrier, shop and mailbox." \
      org.opencontainers.image.source="https://github.com/open-parcels/open-parcels"

# The server only: no web UI, unknown paths answer with the API's 404.
FROM runtime-base AS server
COPY --from=bundle-server --chown=root:root /out/ ./
LABEL org.opencontainers.image.title="open-parcels-server" \
      org.opencontainers.image.description="The open-parcels server without the web UI."

# The default target, last: the server with the web UI.
FROM runtime-base AS runtime
COPY --from=bundle --chown=root:root /out/ ./
