#!/bin/bash
BASEDIR=$(realpath $(dirname $0))
CONTEXT_TARGET=$(dirname $BASEDIR)
CONTEXT_TARGET=$(dirname $CONTEXT_TARGET)

cd $CONTEXT_TARGET

NAME=$(grep '"name"' src/config.json | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
VERSION=$(grep '"version"' src/config.json | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
NAME=$(echo "$NAME" | tr '[:upper:]' '[:lower:]')  # transform camelcase

XO_IMAGE_NAME="${NAME}:${VERSION}"
: "${XO_IMAGE_NAME:=$NAME}"

echo
echo "Starting build: docker build -t \"$XO_IMAGE_NAME\" -f $BASEDIR/Dockerfile ."
echo
docker build --target viewer-standalone -t "$XO_IMAGE_NAME" -f $BASEDIR/Dockerfile .
cd -
