##################
# VIEWER: BUILD###
##################
FROM node:20 AS viewer-build
WORKDIR /tmp
RUN git clone https://github.com/RationAI/openseadragon.git \
    && cd openseadragon \
    && npm i \
    && cd ..

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

USER node

RUN npm ci && npm run build

ENTRYPOINT ["/usr/bin/tini", "--", "npm", "run", "s-node"]
