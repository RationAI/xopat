##################
# VIEWER: BUILD###
##################
FROM node:20 AS viewer-build
WORKDIR /tmp
RUN git clone https://github.com/RationAI/openseadragon.git \
    && cd openseadragon \
    && git reset --hard ea54427f42a076e1a7a33f8590e0de22e7a335f4 \
    && npm i \
    && cd ..

#############################
# VIEWER: PROD GIT       ####
#############################
# Viewer that creates php runtime but does not include code - it must be fetched by the container on startup.
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
    && ln -fs /usr/share/zoneinfo/Europe/Prague /etc/localtime \
    && dpkg-reconfigure --frontend noninteractive tzdata \
    && apt clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/app

RUN rm -f /bin/sh && ln -s /bin/bash /bin/sh \
    # User Id 1000 for kubernetes
    && usermod --non-unique --uid 1000 node

EXPOSE 9000
USER node
WORKDIR /app

###############################
# VIEWER: PROD STANDALONE  ####
###############################
# Viewer with all the necessities
FROM viewer-git AS viewer-standalone
COPY --chown=node:1000 . /app
RUN cd /app && npm install