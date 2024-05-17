#!/bin/bash
BASEDIR=$(realpath $(dirname $0))
CONTEXT_TARGET=$(dirname $BASEDIR)
CONTEXT_TARGET=$(dirname $CONTEXT_TARGET)

cd $CONTEXT_TARGET

if ! command -v docker-compose &> /dev/null
then
  docker compose -f "$BASEDIR/docker-compose.yml" up
else
  docker-compose -f "$BASEDIR/docker-compose.yml" up
fi

