#!/usr/bin/env bash
# Runs on the EC2 server: rebuild the image from the checked-out code and restart the app container.
set -euo pipefail
cd "$(dirname "$0")/.."

docker build -t language-teacher .
docker network create web 2>/dev/null || true
docker rm -f app 2>/dev/null || true
docker run -d --name app --restart unless-stopped --network web --env-file "$HOME/app.env" language-teacher

# Wait until the app answers before reporting success.
for i in $(seq 1 30); do
  if docker run --rm --network web curlimages/curl -fsS http://app:3000/api/config >/dev/null 2>&1; then
    echo "app is healthy"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done
echo "app did not become healthy" >&2
docker logs --tail 50 app >&2
exit 1
