#!/usr/bin/env bash
set -Eeuo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
validation_dir=$(mktemp -d -t parako-compose-validation-XXXXXXXX)
cleanup() {
  find "${validation_dir}" -mindepth 1 -delete 2>/dev/null || true
  rmdir "${validation_dir}" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "${validation_dir}/docker/secrets" "${validation_dir}/runtime"
cp "${repo_root}"/deployment/docker/compose*.yaml "${validation_dir}/docker/"
cp "${repo_root}/.env.example" "${validation_dir}/runtime/.env"
for secret in redis-password postgresql-password mongodb-password; do
  openssl rand -hex 32 >"${validation_dir}/docker/secrets/${secret}"
  chmod 0600 "${validation_dir}/docker/secrets/${secret}"
done

export PARAKO_DOCKER_IMAGE=parako-id:compose-validation
base=(
  docker compose
  --project-directory "${validation_dir}"
  --env-file "${validation_dir}/runtime/.env"
  -f "${validation_dir}/docker/compose.yaml"
  -f "${validation_dir}/docker/compose.tools.yaml"
)
redis=(-f "${validation_dir}/docker/compose.redis.yaml")
postgresql=(-f "${validation_dir}/docker/compose.postgresql.yaml")
mongodb=(-f "${validation_dir}/docker/compose.mongodb.yaml")

"${base[@]}" config --quiet
"${base[@]}" "${redis[@]}" config --quiet
"${base[@]}" "${postgresql[@]}" config --quiet
"${base[@]}" "${mongodb[@]}" config --quiet
"${base[@]}" "${redis[@]}" "${postgresql[@]}" config --quiet
"${base[@]}" "${redis[@]}" "${mongodb[@]}" config --quiet
printf 'All Docker Compose topology combinations are valid.\n'
