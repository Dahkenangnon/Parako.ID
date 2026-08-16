#!/usr/bin/env bash
set -Eeuo pipefail

adapter=${1:-}
image=${2:-parako-id:docker-smoke}
case "${adapter}" in
  sqlite|postgresql|mongodb) ;;
  *) printf 'usage: %s <sqlite|postgresql|mongodb> [image]\n' "$0" >&2; exit 64 ;;
esac

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
install_dir=$(mktemp -d -t "parako-docker-${adapter}-XXXXXXXX")
project="parako-ci-${adapter}-$$"
export PARAKO_COMPOSE_PROJECT=${project}
export PARAKO_DOCKER_IMAGE=${image}
export PARAKO_INSTALL_DIR=${install_dir}

compose_files=(
  -f "${install_dir}/docker/compose.yaml"
  -f "${install_dir}/docker/compose.tools.yaml"
)
if [ "${adapter}" != sqlite ]; then
  compose_files+=(-f "${install_dir}/docker/compose.${adapter}.yaml")
fi
compose_files+=(-f "${install_dir}/docker/compose.redis.yaml")

compose() {
  PARAKO_DOCKER_IMAGE=${image} docker compose \
    --project-directory "${install_dir}" \
    --env-file "${install_dir}/runtime/.env" \
    "${compose_files[@]}" "$@"
}

cleanup() {
  local status=$?
  if [ "${status}" -ne 0 ] && [ -f "${install_dir}/runtime/.env" ]; then
    compose logs --no-color --tail=200 2>/dev/null || true
  fi
  if [ -f "${install_dir}/runtime/.env" ]; then
    compose down --volumes --remove-orphans 2>/dev/null || true
  fi
  find "${install_dir}" -mindepth 1 -delete 2>/dev/null || true
  rmdir "${install_dir}" 2>/dev/null || true
  exit "${status}"
}
trap cleanup EXIT

mkdir -p "${install_dir}/docker" "${install_dir}/runtime"
cp "${repo_root}"/deployment/docker/compose*.yaml "${install_dir}/docker/"
cp "${repo_root}/.env.example" "${install_dir}/docker/.env.sample"
printf 'INSTALL_MODE=docker\nINSTALL_DIR=%s\nVERSION=0.0.0\nDOCKER_IMAGE=%s\n' \
  "${install_dir}" "${image}" >"${install_dir}/.parako-state"

config_args=(
  docker config init
  --url https://id.example.test
  --adapter "${adapter}"
  --redis managed
)
if [ "${adapter}" = sqlite ]; then
  config_args+=(--tenancy single)
else
  config_args+=(--database managed --tenancy multi)
fi
bash "${repo_root}/installer/parako.sh" "${config_args[@]}"
bash "${repo_root}/installer/parako.sh" docker deploy

curl --fail --silent --show-error \
  --header 'X-Forwarded-Proto: https' \
  http://127.0.0.1:9007/readyz \
  | grep -q '"status":"ready"'

[ "$(compose exec -T app id -u)" = 10001 ]
[ "$(compose exec -T app id -g)" = 10001 ]
app_container=$(compose ps -q app)
[ -n "${app_container}" ]
[ "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "${app_container}")" = true ]
compose exec -T app node dist/scripts/manage/database.js status
printf 'Docker topology smoke passed: %s\n' "${adapter}"
