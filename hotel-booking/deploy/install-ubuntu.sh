#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f docker-compose.yml || ! -f backend/scripts/secure-deploy.cjs ]]; then
  echo "Run this script from a clone of the TKQTHT repository." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! sudo docker compose version >/dev/null 2>&1; then
  echo "Docker Engine and the Docker Compose plugin are required. Install/start Docker, then run this script again." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  umask 077
  cp .env.example .env
  env_file=.env
  replace_value() {
    local key="$1" value="$2"
    sed -i "s|^${key}=.*$|${key}=${value}|" "$env_file"
  }
  replace_value POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  replace_value PGADMIN_PASSWORD "$(openssl rand -hex 24)"
  replace_value GRAFANA_PASSWORD "$(openssl rand -hex 24)"
  replace_value SESSION_SECRET "$(openssl rand -hex 32)"
  replace_value STAFF_ADMIN_PASSWORD "$(openssl rand -hex 16)"
  replace_value STAFF_RECEPTION_PASSWORD "$(openssl rand -hex 16)"

  mkdir -p secrets/local
  chmod 700 secrets secrets/local
  cat > secrets/local/INITIAL-CREDENTIALS.txt <<EOF
Initial login credentials (generated on first install)
Website: https://$(hostname -I | awk '{print $1}'):8443
Staff administrator: admin / $(sed -n 's/^STAFF_ADMIN_PASSWORD=//p' .env)
Reception: letan / $(sed -n 's/^STAFF_RECEPTION_PASSWORD=//p' .env)
Grafana: admin / $(sed -n 's/^GRAFANA_PASSWORD=//p' .env)
pgAdmin: admin@example.com / $(sed -n 's/^PGADMIN_PASSWORD=//p' .env)

Keep this file private. Change the passwords before reusing this server.
EOF
  chmod 600 secrets/local/INITIAL-CREDENTIALS.txt
  echo "Created .env and generated demo credentials."
fi

if grep -q '^COMPOSE_FILE=' .env; then
  sed -i 's|^COMPOSE_FILE=.*$|COMPOSE_FILE=docker-compose.yml:docker-compose.self-signed.yml|' .env
else
  printf '\nCOMPOSE_FILE=docker-compose.yml:docker-compose.self-signed.yml\n' >> .env
fi

if grep -Eq 'CHANGE_ME' .env; then
  echo "Configure the remaining CHANGE_ME values in .env, then rerun this script." >&2
  exit 1
fi

server_ip="$(hostname -I | awk '{print $1}')"
if [[ -z "$server_ip" ]]; then
  echo "Could not determine the Ubuntu server IP for the HTTPS certificate." >&2
  exit 1
fi
mkdir -p certs/local
chmod 700 certs certs/local
if [[ ! -f certs/local/server.crt || ! -f certs/local/server.key ]] \
  || ! openssl x509 -in certs/local/server.crt -noout -checkend 0 >/dev/null 2>&1 \
  || ! openssl x509 -in certs/local/server.crt -noout -ext subjectAltName 2>/dev/null | grep -Fq "IP Address:$server_ip"; then
  cat > certs/local/openssl-san.cnf <<EOF
[req]
distinguished_name = distinguished_name
x509_extensions = server_extensions
prompt = no
[distinguished_name]
CN = $server_ip
[server_extensions]
subjectAltName = IP:$server_ip
EOF
  openssl req -x509 -nodes -newkey rsa:2048 -sha256 -days 365 \
    -keyout certs/local/server.key \
    -out certs/local/server.crt \
    -config certs/local/openssl-san.cnf
fi
chmod 644 certs/local/server.crt certs/local/server.key

echo "Building and deploying the application and observability stack..."
uid="$(id -u)"
gid="$(id -g)"
sudo docker run --rm \
  -e DOCKER_HOST=unix:///var/run/docker.sock \
  -e DOCKER_API_VERSION=1.41 \
  -e DEPLOY_UID="$uid" \
  -e DEPLOY_GID="$gid" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$ROOT:$ROOT" \
  -w "$ROOT" \
  node:24-alpine sh -ec '
    apk add --no-cache docker-cli docker-cli-compose >/dev/null
    npm ci --prefix backend
    node backend/scripts/prepare-secrets.cjs
    chown -R "$DEPLOY_UID:$DEPLOY_GID" secrets/local
    chmod 700 secrets/local
    find secrets/local -maxdepth 1 -type f ! -name INITIAL-CREDENTIALS.txt -exec chmod 644 {} +
    docker compose config --quiet
    node backend/scripts/secure-deploy.cjs
    docker compose --profile host-observability --profile linux-host-logs up -d --no-build --wait cadvisor promtail
    chown -R "$DEPLOY_UID:$DEPLOY_GID" secrets/local
    chmod 700 secrets/local
    find secrets/local -maxdepth 1 -type f ! -name INITIAL-CREDENTIALS.txt -exec chmod 644 {} +
    chmod 600 secrets/local/INITIAL-CREDENTIALS.txt 2>/dev/null || true
  '

echo
echo "Deployment complete. Services:"
sudo docker compose ps
echo
echo "Website:  https://$server_ip:8443 (self-signed certificate; browser warning is expected)"
echo "HTTP redirect: http://$server_ip:8000"
echo "Grafana:  http://$(hostname -I | awk '{print $1}'):3000"
echo "Login details (first install only): secrets/local/INITIAL-CREDENTIALS.txt"
echo "Keep the secrets and data safe; do not run 'docker compose down -v' unless you intend to erase them."
