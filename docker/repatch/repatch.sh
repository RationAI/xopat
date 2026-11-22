#!/usr/bin/env bash
# Re-patch published xOpat images: newest release of the Node line ALREADY in the image
# + OS package updates, without rebuilding the application (docker/repatch/Dockerfile).
# Used locally and by .github/workflows/docker-repatch.yml.
#
#   docker/repatch/repatch.sh [options] <image>:<tag> [<image>:<tag> ...]
#   e.g. docker/repatch/repatch.sh xopat:3.2.1 xopat-php:3.2.1
#
# Options:
#   --push        publish (default: build + smoke-test only, nothing leaves the machine)
#   --node <ver>  force a Node version (default: auto = newest release of the image's
#                 own major line, from nodejs.org); a different major is always refused
#   --if-needed   skip a tag that already runs that Node and has no pending OS updates
#
# Per tag, with --push:
#   <tag>-orig      untouched original, created once and never overwritten; every
#                   re-patch starts from it, so layers do not stack; rollback = re-tag it
#   <tag>           moved to the patched build
#   <tag>-node<v>   immutable alias naming the runtime (images that contain Node)
#   latest          moved too, if it pointed at <tag>
#
# Images whose Node line is past end-of-life cannot be patched in place (that needs a
# major upgrade = a new release); they are reported as `unsupported`, not failed.
#
# Prints one `RESULT <image>:<tag> <status> <detail>` line per target, where status is
# patched | built | current | unsupported | missing | failed. Exit 1 if any failed.
# Requires: docker with buildx, curl, node (for JSON parsing); `docker login ghcr.io`
# with write:packages for --push.
set -uo pipefail
# Git Bash on Windows rewrites container paths like `/app` into host paths…
export MSYS_NO_PATHCONV=1

REGISTRY="${REPATCH_REGISTRY:-ghcr.io/rationai}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# …so host paths are converted explicitly instead.
command -v cygpath >/dev/null 2>&1 && HERE="$(cygpath -m "$HERE")"

PUSH=false
NODE_FORCE=""
IF_NEEDED=false
TARGETS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --push) PUSH=true ;;
    --node) NODE_FORCE="$2"; shift ;;
    --if-needed) IF_NEEDED=true ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    *) TARGETS+=("$1") ;;
  esac
  shift
done
[ ${#TARGETS[@]} -gt 0 ] || { sed -n '2,29p' "$0"; exit 1; }
[ "$NODE_FORCE" = "auto" ] && NODE_FORCE=""
if [ -n "$NODE_FORCE" ] && ! [[ "$NODE_FORCE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "bad --node '$NODE_FORCE'"; exit 1
fi

# --- Node release metadata (fetched once) ---
NODE_INDEX=""; NODE_SCHEDULE=""
node_meta() {
  [ -n "$NODE_INDEX" ] || NODE_INDEX="$(curl -fsSL https://nodejs.org/dist/index.json)" \
    || { echo "cannot fetch nodejs.org/dist/index.json" >&2; return 1; }
  [ -n "$NODE_SCHEDULE" ] || NODE_SCHEDULE="$(curl -fsSL https://raw.githubusercontent.com/nodejs/Release/main/schedule.json)" \
    || { echo "cannot fetch Node release schedule" >&2; return 1; }
}
# newest release of a major line, e.g. 24 -> 24.22.3
node_latest() {
  printf '%s' "$NODE_INDEX" | node -e '
    const m = process.argv[1];
    const r = JSON.parse(require("fs").readFileSync(0, "utf8")).find(v => v.version.startsWith("v" + m + "."));
    if (r) console.log(r.version.slice(1));' "$1"
}
# end-of-life date of a major line (YYYY-MM-DD), empty if unknown
node_eol() {
  printf '%s' "$NODE_SCHEDULE" | node -e '
    const s = JSON.parse(require("fs").readFileSync(0, "utf8"))["v" + process.argv[1]];
    if (s) console.log(s.end);' "$1"
}

# Digest of a published ref, EMPTY when the ref does not exist. Every other failure
# (auth, rate limit, network) returns non-zero instead of looking like "no such tag":
# a lookup of <tag>-orig that merely failed would otherwise re-patch the already
# patched image and then overwrite the real -orig with it.
digest() {
  local out err rc
  err="$(mktemp)"
  out="$(docker buildx imagetools inspect "$1" --format '{{json .Manifest.Digest}}' 2>"$err")"; rc=$?
  if [ $rc -eq 0 ] && [ -n "$out" ]; then rm -f "$err"; printf '%s' "$out" | tr -d '"'; return 0; fi
  if grep -qiE ': not found$|manifest unknown' "$err"; then rm -f "$err"; return 0; fi
  echo "registry lookup failed for $1: $(tail -n 1 "$err")" >&2
  rm -f "$err"; return 1
}
in_image() { docker run --rm --user root --entrypoint sh "$1" -c "$2" 2>/dev/null; }

RESULTS=()
result() { RESULTS+=("RESULT $1 $2 ${3:-}"); echo "RESULT $1 $2 ${3:-}"; }

repatch_one() {
  local target="$1" name tag image cur orig base latest move_latest user old major eol node \
        local_tag probe current_node pending got code running running_user t
  name="${target%%:*}"; tag="${target#*:}"; image="$REGISTRY/$name"
  echo "=== $image:$tag (push=$PUSH)"

  cur="$(digest "$image:$tag")" || { result "$target" failed "registry lookup $image:$tag"; return 1; }
  [ -n "$cur" ] || { result "$target" missing "not published"; return 0; }
  orig="$(digest "$image:$tag-orig")" || { result "$target" failed "registry lookup $image:$tag-orig"; return 1; }
  if [ -n "$orig" ]; then base="$image:$tag-orig"; else base="$image:$tag"; orig="$cur"; fi
  latest="$(digest "$image:latest")" || { result "$target" failed "registry lookup $image:latest"; return 1; }
  move_latest=false
  { [ "$latest" = "$orig" ] || [ "$latest" = "$cur" ]; } && move_latest=true

  docker pull -q "$base" >/dev/null || { result "$target" failed "pull $base"; return 1; }
  user="$(docker image inspect "$base" --format '{{.Config.User}}')"

  # --- pick the Node release for this image's own major line ---
  old="$(in_image "$base" 'command -v node >/dev/null && node -v' || true)"
  node=""
  if [ -n "$old" ]; then
    major="${old#v}"; major="${major%%.*}"
    if [ -n "$NODE_FORCE" ]; then
      node="$NODE_FORCE"
    else
      node_meta || { result "$target" failed "Node metadata unavailable"; return 1; }
      eol="$(node_eol "$major")"
      if [ -n "$eol" ] && [[ "$eol" < "$(date -u +%Y-%m-%d)" ]]; then
        result "$target" unsupported "Node $old (v$major end-of-life $eol)"
        return 0
      fi
      node="$(node_latest "$major")"
      [ -n "$node" ] || { result "$target" failed "no Node $major release found"; return 1; }
    fi
    [ "${node%%.*}" = "$major" ] || { result "$target" unsupported "Node $old cannot move to $node in place"; return 0; }
    echo "Node line v$major: $old -> v$node"
  else
    echo "no Node runtime in image: OS updates only"
  fi

  # --- skip when the published tag is already current ---
  if $IF_NEEDED; then
    # One run, two labelled lines. "current" needs a POSITIVE answer: a probe that
    # could not run, or an `apt-get update` that failed, prints no `APT:0` and so
    # falls through to a rebuild instead of passing as up to date.
    probe="$(in_image "$image:$tag" 'echo "NODE:$(command -v node >/dev/null 2>&1 && node -v)"
      if command -v apt-get >/dev/null 2>&1; then
        apt-get update -qq >/dev/null 2>&1 && echo "APT:$(apt list --upgradable 2>/dev/null | grep -c "upgradable from")" || echo "APT:ERR"
      else echo "APT:0"; fi' || true)"
    current_node="$(printf '%s\n' "$probe" | sed -n 's/^NODE://p')"
    pending="$(printf '%s\n' "$probe" | sed -n 's/^APT://p')"
    if [ "${current_node#v}" = "$node" ] && [ "$pending" = "0" ]; then
      result "$target" current "${current_node:-no Node}, no OS updates pending"
      return 0
    fi
  fi

  local_tag="xopat-repatch/$name:$tag"
  docker buildx build --load --pull --provenance=false \
    --build-arg BASE_IMAGE="$base" \
    --build-arg NODE_IMAGE="node:${node:-lts}-slim" \
    --build-arg RUN_USER="${user:-root}" \
    --label "io.xopat.repatched=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --label "io.xopat.repatch.node=${node:-none}" \
    --label "io.xopat.repatch.base=$base@$orig" \
    -t "$local_tag" "$HERE" || { result "$target" failed "build"; return 1; }

  # --- smoke test ---
  docker rm -f xopat-repatch-smoke >/dev/null 2>&1 || true
  if [ -n "$node" ]; then
    got="$(docker run --rm --entrypoint node "$local_tag" -v)"
    [ "$got" = "v$node" ] || { result "$target" failed "expected v$node, got $got"; return 1; }
    # native addons must still load under the new binary (same-ABI check)
    docker run --rm --entrypoint node -w /app "$local_tag" -e \
      "try{require('sharp')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}" \
      || { result "$target" failed "native addon load"; return 1; }
    docker run -d --name xopat-repatch-smoke -p 127.0.0.1:19000:9000 "$local_tag" >/dev/null
    code=000
    for _ in $(seq 1 30); do
      code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:19000/ || true)"
      [ "$code" != "000" ] && break; sleep 2
    done
    docker logs xopat-repatch-smoke 2>&1 | tail -n 15
    docker rm -f xopat-repatch-smoke >/dev/null
    { [ "$code" != "000" ] && [ "$code" -lt 500 ]; } || { result "$target" failed "server did not answer (HTTP $code)"; return 1; }
  else
    docker run -d --name xopat-repatch-smoke "$local_tag" >/dev/null
    sleep 10
    docker logs xopat-repatch-smoke 2>&1 | tail -n 15
    running="$(docker inspect -f '{{.State.Running}}' xopat-repatch-smoke)"
    docker rm -f xopat-repatch-smoke >/dev/null
    [ "$running" = "true" ] || { result "$target" failed "container exited"; return 1; }
  fi

  $PUSH || { result "$target" built "${old:-no Node}${node:+ -> v$node}, smoke ok"; return 0; }

  # --- publish ---
  if [ "$base" = "$image:$tag" ]; then
    echo "preserving original as $image:$tag-orig"
    docker buildx imagetools create -t "$image:$tag-orig" "$image:$tag@$orig" \
      || { result "$target" failed "could not preserve -orig"; return 1; }
  fi
  local tags=("$image:$tag")
  [ -n "$node" ] && tags+=("$image:$tag-node$node")
  $move_latest && tags+=("$image:latest")
  for t in "${tags[@]}"; do
    docker tag "$local_tag" "$t" && docker push -q "$t" >/dev/null \
      || { result "$target" failed "push $t"; return 1; }
    echo "pushed $t"
  done
  result "$target" patched "${old:-no Node}${node:+ -> v$node}$($move_latest && echo ', latest moved')"
}

failed=0
for target in "${TARGETS[@]}"; do
  repatch_one "$target" || failed=1
done

echo
echo "=== summary"
printf '%s\n' "${RESULTS[@]}"
exit $failed
