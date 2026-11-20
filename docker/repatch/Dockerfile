#############################################
# RE-PATCH A PUBLISHED xOpat IMAGE         ##
#############################################
# Overlays a security-patched Node runtime and Debian/Ubuntu package updates onto an
# already published image WITHOUT rebuilding the application. The app bytes (/app,
# built bundles, node_modules) stay identical to the release; only the runtime moves.
#
# Safety rule: Node is swapped only within the SAME major line. A patch release keeps
# NODE_MODULE_VERSION (native addon ABI, e.g. sharp) and the JS API stable; a major jump
# does not, so the build FAILS instead of producing a silently different runtime.
# Images without Node (the PHP runtime) only receive the OS package updates.
#
# Driven by docker/repatch/repatch.sh (locally and from .github/workflows/docker-repatch.yml),
# which picks the Node release and owns the tagging policy.

# Always passed by repatch.sh. The `scratch` default only satisfies the linter: it has no
# shell, so a build that forgets the argument fails instead of producing an image.
ARG BASE_IMAGE=scratch
ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS node

FROM ${BASE_IMAGE}
ARG RUN_USER=root

USER root

# Node swap (same major only). npm/corepack are replaced as whole directories so no
# stale files of the old version survive; corepack is absent from newer Node lines.
RUN --mount=type=bind,from=node,source=/usr/local,target=/patch-node \
    set -eu; \
    if ! command -v node >/dev/null 2>&1; then \
        echo "repatch: no Node runtime in base image, skipping Node swap"; \
    else \
        old="$(node -v)"; new="$(/patch-node/bin/node -v)"; \
        old_major="${old%%.*}"; new_major="${new%%.*}"; \
        if [ "$old_major" != "$new_major" ]; then \
            echo "repatch: refusing major Node change $old -> $new (rebuild the release instead)" >&2; \
            exit 1; \
        fi; \
        target="$(dirname "$(readlink -f "$(command -v node)")")"; \
        echo "repatch: Node $old -> $new in $target"; \
        cp -f /patch-node/bin/node "$target/node"; \
        for pkg in npm corepack; do \
            if [ -d "/patch-node/lib/node_modules/$pkg" ] && [ -d "$target/../lib/node_modules/$pkg" ]; then \
                rm -rf "$target/../lib/node_modules/$pkg"; \
                cp -a "/patch-node/lib/node_modules/$pkg" "$target/../lib/node_modules/$pkg"; \
            fi; \
        done; \
        test "$(node -v)" = "$new"; \
    fi

# OS security updates within the base distribution release (no dist-upgrade).
RUN set -eu; \
    if ! command -v apt-get >/dev/null 2>&1; then echo "repatch: no apt-get, skipping OS updates"; exit 0; fi; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update -y; \
    apt-get upgrade -y --no-install-recommends -o Dpkg::Options::=--force-confold; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

USER ${RUN_USER}
