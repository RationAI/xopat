FROM ubuntu:jammy AS viewer-build-deps

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US:en
ENV LC_ALL en_US.UTF-8

ENV NVM_DIR /usr/local/nvm
ENV NODE_VERSION 18.7.0
ENV NODE_PATH $NVM_DIR/versions/node/v$NODE_VERSION/lib/node_modules
ENV PATH      $NVM_DIR/versions/node/v$NODE_VERSION/bin:$PATH

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -y && apt-get install --no-install-recommends --fix-missing -y \
        # Cloning Deps
        git \
        apt-transport-https \
        ca-certificates \
        curl \
        wget \
        s6 \
        locales \
        tzdata \
    && ln -fs /usr/share/zoneinfo/Europe/Prague /etc/localtime \
    && dpkg-reconfigure --frontend noninteractive tzdata \
    && apt clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/app

RUN rm -f /bin/sh && ln -s /bin/bash /bin/sh \
    # Node (see https://stackoverflow.com/questions/25899912/how-to-install-nvm-in-docker)
    && mkdir $NVM_DIR \
    && curl https://raw.githubusercontent.com/creationix/nvm/v0.39.1/install.sh | bash \
    && . $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default

##################
# VIEWER: BUILD###
##################
FROM viewer-build-deps AS viewer-build
WORKDIR /tmp
RUN git clone https://github.com/RationAI/openseadragon.git \
    && cd openseadragon \
    && git reset --hard ea54427f42a076e1a7a33f8590e0de22e7a335f4 \
    && npm i \
    && cd ..


##################
# VIEWER: DEV  ###
##################
FROM viewer-build AS viewer-dev

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -y && apt-get install --no-install-recommends --fix-missing -y \
        # HTTP Server
        apache2 \
        tini \
        # PHP Apps
        libapache2-mod-php \
        php-cli \
        php-curl \
        php-mbstring \
        php-json \
        php-mime-type \
        vim \
        nano \
        # Ssh+dev
        rsync \
        openssh-client \
        fakeroot \
    && apt clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /bin/sh && ln -s /bin/bash /bin/sh \
    #for reverse proxy, enable: && a2enmod proxy proxy_http \
    # Auth: enable modules, prepare files/dirs
    && a2enmod rewrite headers expires ext_filter env dir proxy proxy_http \
    && touch /etc/apache2/.env.apache && mkdir -p /usr/local/etc/apache /var/www/html/xopat  \
    # Other
    && chown -R www-data:www-data /var/lock /var/log /var/www /var/run /run/lock /etc/apache2/.env.apache \
    && chmod --recursive 777 /var/run

COPY --chown=www-data:www-data docker/php/apache-dev.conf /etc/apache2/sites-available/000-default.conf

EXPOSE 8000
USER www-data
WORKDIR /var/www

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD apache2ctl -D FOREGROUND

#############################
# VIEWER: PROD STANDALONE####
#############################
# Viewer that creates php runtime but does not include code - it must be fetched by the container on startup.
FROM ubuntu:jammy AS viewer-git

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US:en
ENV LC_ALL en_US.UTF-8

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -y && apt-get install --no-install-recommends --fix-missing -y \
        curl \
        locales \
        tzdata \
        # HTTP Server
        apache2 \
        tini \
        # PHP Apps
        libapache2-mod-php \
        php-cli \
        php-curl \
        php-mbstring \
        php-json \
        php-mime-type \
        vim \
        nano \
    && ln -fs /usr/share/zoneinfo/Europe/Prague /etc/localtime \
    && dpkg-reconfigure --frontend noninteractive tzdata \
    && apt clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/app

RUN rm -f /bin/sh && ln -s /bin/bash /bin/sh \
    # User Id 1000 for kubernetes
    && usermod --non-unique --uid 1000 www-data \
    #for reverse proxy, enable: && a2enmod proxy proxy_http \
    # Auth: enable modules, prepare files/dirs
    && a2enmod rewrite headers expires ext_filter env dir proxy proxy_http \
    && touch /etc/apache2/.env.apache && mkdir -p /usr/local/etc/apache /var/www/html/xopat \
    # Other
    && chown -R www-data:www-data /var/lock /var/log /var/www /var/run /run/lock /etc/apache2/.env.apache \
    && chmod --recursive 777 /var/run
    # \ && echo "RewriteEngine on\nRewriteRule .* xopat/index.php [NL,L,QSA]" > /var/www/html/.htaccess

COPY --chown=www-data:www-data docker/php/apache.conf /etc/apache2/sites-available/000-default.conf

EXPOSE 8000
USER www-data
WORKDIR /var/www

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD apache2ctl -D FOREGROUND


#############################
# VIEWER: PROD GIT       ####
#############################
# Viewer with all the necessities
FROM viewer-git AS viewer-standalone
COPY .htaccess /var/www/html/xopat/
COPY *.html /var/www/html/xopat/
COPY *.php /var/www/html/xopat/
COPY *.json /var/www/html/xopat/
COPY *.md /var/www/html/xopat/
COPY docs/assets/ /var/www/html/xopat/docs/assets
COPY src/ /var/www/html/xopat/src
COPY server/ /var/www/html/xopat/server
COPY plugins/ /var/www/html/xopat/plugins
COPY modules/ /var/www/html/xopat/modules
COPY env/ /var/www/html/xopat/env
COPY --from=viewer-build /tmp/openseadragon/build /var/www/html/xopat/openseadragon/build
