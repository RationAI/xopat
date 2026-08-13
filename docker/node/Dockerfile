#############################
# VIEWER: PROD GIT       ####
#############################
# Viewer that creates php runtime but does not include code - it must be fetched by the container on startup.
# Note that the viewer might newly require build tasks to proceed - the init container must have NPM and run npm run build.
FROM node:20 AS viewer-git

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
# VIEWER: PROD STANDALONE  ####
###############################
FROM viewer-git AS viewer-standalone

ENV XO_REPO_ROOT=/app
WORKDIR /app

USER root

COPY --chown=node:node . /app

# `--chown` sets ownership but not mode; a Windows/OneDrive build context arrives
# with directories at 0555, so the build below cannot write its own artifacts
# (`Unable to write "modules/annotations/index.min.js" (Error code: EACCES)`).
RUN chmod -R u+rwX /app

USER node

# `ci` (default): reproducible and lockfile-strict
# `install`: runs a fresh install
ARG NPM_INSTALL_MODE=ci

# `minify` is a superset of `build` (workspaceBuild + buildUI + buildCore) plus
# prepMinify + uglify + bundleModules, so the image ships the production min
# artifacts (index.min.js / index.min.mjs / index.workspace.min.js /
# src/dist/xopat-core.min.js / ui/index.min.js). They are only *served* when the
# deployment sets client.production: true, so this is safe for dev images too.
RUN npm "$NPM_INSTALL_MODE" && npm run minify

# Setting XOPAT_WORKERS selects the cluster supervisor; unset stays single-process.
#
# `exec node ...` rather than `npm run ...`: npm sits between tini and node as an
# extra process that does not forward SIGTERM reliably, which would defeat the
# graceful drain (in-flight NDJSON streams, pending session write-backs). With
# exec, tini's direct child IS node and the signal lands where the handler is.
ENTRYPOINT ["/usr/bin/tini", "--", "sh", "-c", \
    "if [ -n \"$XOPAT_WORKERS\" ]; then exec node server/node/cluster-index.js \"$@\"; else exec node index.js \"$@\"; fi", "--"]
