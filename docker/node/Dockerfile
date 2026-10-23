#############################
# VIEWER: PROD GIT       ####
#############################
# Viewer that creates php runtime but does not include code - it must be fetched by the container on startup.
# Note that the viewer might newly require build tasks to proceed - the init container must have NPM and run npm run build.
# Pinned to the patch release so a cached base cannot keep a vulnerable runtime; bump on each Node security release.
FROM node:24.22.1 AS viewer-git

ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -y && apt-get install --no-install-recommends --fix-missing -y \
        curl \
        locales \
        tzdata \
        git \
        ca-certificates \
        vim \
        nano \
        tini \
    && ln -fs /usr/share/zoneinfo/Europe/Prague /etc/localtime \
    && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen \
    && locale-gen en_US.UTF-8 \
    && dpkg-reconfigure --frontend noninteractive tzdata \
    && apt clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/app

RUN rm -f /bin/sh && ln -s /bin/bash /bin/sh \
    # User Id 1000 for kubernetes
    && usermod --non-unique --uid 1000 node \
    && mkdir -p /app \
    && chown -R node:node /app

EXPOSE 9000
USER node
WORKDIR /app

###############################
# VIEWER: BUILD STANDALONE ####
###############################
# Build stage only — nothing here ships except /app. Kept on the full node image
# for its toolchain (git, compilers for any native fallback build).
FROM node:24.22.1 AS viewer-standalone-build

WORKDIR /app
COPY . /app

# `ci` (default): reproducible and lockfile-strict
# `install`: runs a fresh install
ARG NPM_INSTALL_MODE=ci

# The Cypress binary (~800 MB in ~/.cache/Cypress) is only for the legacy e2e
# suite, never for serving; the npm package itself stays so the lockfile and the
# installed-dependency identity (server build key) are unchanged.
ENV CYPRESS_INSTALL_BINARY=0

# `minify` is a superset of `build` (workspaceBuild + buildUI + buildCore) plus
# prepMinify + uglify + bundleModules, so the image ships the production min
# artifacts (index.min.js / index.min.mjs / index.workspace.min.js /
# src/dist/xopat-core.min.js / ui/index.min.js). They are only *served* when the
# deployment sets client.production: true, so this is safe for dev images too.
#
# node_modules is deliberately NOT pruned to production: the server still needs
# `esbuild` and `comment-json` (devDependencies) at runtime, and the server
# bundle freshness key hashes node_modules/.package-lock.json — pruning would
# mark every prebuilt `.server-dist` bundle stale.
#
# The npm cache lives in a cache mount, not a layer. `.git` was needed only for
# the build. The chmod fixes a Windows/OneDrive build context that arrives with
# directories at 0555, which the runtime (as `node`) must be able to write into
# (`.server-dist` rebuilds, server cache).
RUN --mount=type=cache,target=/root/.npm \
    npm "$NPM_INSTALL_MODE" && npm run minify \
    && rm -rf .git \
    && chmod -R u+rwX /app

###############################
# VIEWER: PROD STANDALONE  ####
###############################
# Runtime on the slim variant of the same Node release (same Debian), without the
# ~800 MB build toolchain of the full image. The only native addon (sharp) ships
# its own libvips.
FROM node:24.22.1-slim AS viewer-standalone

ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -y && apt-get install --no-install-recommends --fix-missing -y \
        curl \
        locales \
        tzdata \
        ca-certificates \
        tini \
    && ln -fs /usr/share/zoneinfo/Europe/Prague /etc/localtime \
    && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen \
    && locale-gen en_US.UTF-8 \
    && dpkg-reconfigure --frontend noninteractive tzdata \
    && apt clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /bin/sh && ln -s /bin/bash /bin/sh \
    # User Id 1000 for kubernetes
    && usermod --non-unique --uid 1000 node

ENV XO_REPO_ROOT=/app
WORKDIR /app

# One layer, owned by `node` at copy time — a separate chown/chmod RUN would
# duplicate every file into a second layer.
COPY --from=viewer-standalone-build --chown=node:node /app /app

EXPOSE 9000
USER node

# Setting XOPAT_WORKERS selects the cluster supervisor; unset stays single-process.
#
# `exec node ...` rather than `npm run ...`: npm sits between tini and node as an
# extra process that does not forward SIGTERM reliably, which would defeat the
# graceful drain (in-flight NDJSON streams, pending session write-backs). With
# exec, tini's direct child IS node and the signal lands where the handler is.
ENTRYPOINT ["/usr/bin/tini", "--", "sh", "-c", \
    "if [ -n \"$XOPAT_WORKERS\" ]; then exec node server/node/cluster-index.js \"$@\"; else exec node index.js \"$@\"; fi", "--"]
