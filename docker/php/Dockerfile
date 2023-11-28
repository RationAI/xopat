# Step 2: Run Docker. Do not use debian-based images: libjpeg8 not available!
FROM ubuntu:jammy AS viewer

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
        php-pgsql \
        vim \
        nano \
        # Ssh+dev
        rsync \
        openssh-client \
        fakeroot \
    && ln -fs /usr/share/zoneinfo/Europe/Prague /etc/localtime \
    && dpkg-reconfigure --frontend noninteractive tzdata \
    && apt clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/app

RUN rm -f /bin/sh && ln -s /bin/bash /bin/sh \
    && phpenmod pdo_pgsql \
    #for reverse proxy, enable: && a2enmod proxy proxy_http \
    # Auth: enable modules, prepare files/dirs
    && a2enmod rewrite headers expires ext_filter env dir proxy proxy_http \
    && touch /etc/apache2/.env.apache && mkdir -p /usr/local/etc/apache/  \
    # Node (see https://stackoverflow.com/questions/25899912/how-to-install-nvm-in-docker)
    && mkdir $NVM_DIR \
    && curl https://raw.githubusercontent.com/creationix/nvm/v0.39.1/install.sh | bash \
    && . $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default \
    # Other
    && chown -R www-data:www-data /var/lock /var/log /var/www /var/run /run/lock /etc/apache2/.env.apache \
    && chmod --recursive 777 /var/run
    # \ && echo "RewriteEngine on\nRewriteRule .* xopat/index.php [NL,L,QSA]" > /var/www/html/.htaccess

COPY --chown=www-data:www-data apache.conf /etc/apache2/sites-available/000-default.conf

EXPOSE 8000
USER www-data
WORKDIR /var/www

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD apache2ctl -D FOREGROUND
