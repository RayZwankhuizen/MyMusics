#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/mymusics
DATA_DIR=/var/lib/mymusics
STATUS_FILE="$DATA_DIR/update-status.json"
REPO=RayZwankhuizen/MyMusics
AUTH_CONFIG=
TAG=
BACKUP=
WORK_DIR=
OLD_MOVED=0
FAIL_MESSAGE="Update failed. Check journalctl -u mymusics-update.service."

write_status() {
  local temporary
  temporary=$(mktemp "$DATA_DIR/.update-status.XXXXXX")
  if ! UPDATE_STATE="$1" UPDATE_TAG="${2:-$TAG}" UPDATE_MESSAGE="$3" UPDATE_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({state:process.env.UPDATE_STATE,version:process.env.UPDATE_TAG,message:process.env.UPDATE_MESSAGE,updatedAt:process.env.UPDATE_DATE})+"\n");' "$temporary" \
    || ! chown mymusics:mymusics "$temporary" \
    || ! chmod 0644 "$temporary" \
    || ! mv -f -- "$temporary" "$STATUS_FILE"; then
    rm -f -- "$temporary"
    return 1
  fi
}

restore_service_files() {
  install -m 0755 "$APP_DIR/deploy/mymusics-update.sh" /usr/local/sbin/mymusics-update || return 1
  install -m 0644 "$APP_DIR/deploy/mymusics.service" /etc/systemd/system/mymusics.service || return 1
  install -m 0644 "$APP_DIR/deploy/mymusics-update.service" /etc/systemd/system/mymusics-update.service || return 1
  install -m 0440 "$APP_DIR/deploy/mymusics-update.sudoers" /etc/sudoers.d/mymusics-update || return 1
}

rollback() {
  [[ "$OLD_MOVED" == 1 ]] || return 0
  [[ -d "$BACKUP" ]] || return 1
  local failed_dir
  failed_dir=$(mktemp -d /opt/.mymusics.failed.XXXXXX) || return 1
  rmdir "$failed_dir" || return 1
  if [[ -e "$APP_DIR" ]]; then mv "$APP_DIR" "$failed_dir" || return 1; fi
  mv "$BACKUP" "$APP_DIR" || return 1
  BACKUP=
  OLD_MOVED=0
  rm -rf -- "$failed_dir" || true
  restore_service_files || return 1
  systemctl daemon-reload || return 1
  systemctl restart mymusics.service || return 1
  systemctl is-active --quiet mymusics.service || return 1
}

on_exit() {
  local code=$?
  trap - EXIT INT TERM
  if (( code != 0 )); then
    if ! rollback; then FAIL_MESSAGE="${FAIL_MESSAGE} Rollback failed; inspect /opt/mymusics and the previous-version backup."; fi
    write_status failed "$TAG" "$FAIL_MESSAGE" || true
  fi
  [[ -z "$WORK_DIR" || ! -d "$WORK_DIR" ]] || rm -rf -- "$WORK_DIR"
  [[ -z "$AUTH_CONFIG" ]] || rm -f -- "$AUTH_CONFIG"
  exit "$code"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

exec 9>/run/lock/mymusics-update.lock
if ! flock -n 9; then exit 0; fi

if [[ -n "${GITHUB_ACCESS_TOKEN:-}" ]]; then
  AUTH_CONFIG=$(mktemp /run/mymusics-curl.XXXXXX)
  chmod 600 "$AUTH_CONFIG"
  printf 'oauth2-bearer = "%s"\n' "$GITHUB_ACCESS_TOKEN" > "$AUTH_CONFIG"
fi

write_status checking "" "Checking the latest GitHub release."
curl_auth=()
[[ -z "$AUTH_CONFIG" ]] || curl_auth=(--config "$AUTH_CONFIG")
release_json=$(curl -fsSL --retry 2 --retry-all-errors --connect-timeout 10 --max-time 60 "${curl_auth[@]}" \
  -H 'Accept: application/vnd.github+json' -H 'User-Agent: MyMusics' \
  "https://api.github.com/repos/$REPO/releases/latest")
TAG=$(printf '%s' "$release_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);process.stdout.write(r.tag_name||"")})')
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
asset_url=$(printf '%s' "$release_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).assets?.find(x=>x.name==="mymusics.tar.gz");if(!a||!a.url.startsWith("https://api.github.com/repos/RayZwankhuizen/MyMusics/releases/assets/"))process.exit(1);process.stdout.write(a.url)})')

WORK_DIR=$(mktemp -d /opt/.mymusics-update.XXXXXX)
mkdir "$WORK_DIR/app"
write_status downloading "$TAG" "Downloading $TAG from GitHub."
curl -fLsS --retry 2 --retry-all-errors --connect-timeout 10 --max-time 300 "${curl_auth[@]}" \
  --max-filesize 524288000 -H 'Accept: application/octet-stream' "$asset_url" -o "$WORK_DIR/mymusics.tar.gz"
archive_entries=$(tar -tzf "$WORK_DIR/mymusics.tar.gz")
printf '%s\n' "$archive_entries" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=s.trimEnd().split("\n");if(!p.length||p.some(x=>x.startsWith("/")||x.includes("\\")||x.split("/").some(y=>y===".."||y===".")))process.exit(1)})'
tar -tvzf "$WORK_DIR/mymusics.tar.gz" | awk 'substr($0,1,1)!~/[-d]/ { exit 1 }'
tar -xzf "$WORK_DIR/mymusics.tar.gz" --no-same-owner --no-same-permissions -C "$WORK_DIR/app"

for file in VERSION BUILD_DATE server.js storage.js jellyfin.js playlists.js package.json package-lock.json stations.json \
  deploy/runtime-files.txt \
  deploy/mymusics-update.sh deploy/mymusics-install-mpv.sh deploy/mymusics.service deploy/mymusics-update.service deploy/mymusics-update.sudoers \
  routes/updates.js routes/stations.js routes/station-discovery.js routes/music.js routes/videos.js routes/metadata.js routes/health.js; do
  [[ -f "$WORK_DIR/app/$file" ]]
done
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  case "$file" in /*|../*|*/../*|*/..|.|./*) exit 1 ;; esac
  [[ -e "$WORK_DIR/app/$file" ]]
done < "$WORK_DIR/app/deploy/runtime-files.txt"
[[ "$(cat "$WORK_DIR/app/VERSION")" == "$TAG" ]]
npm_config_cache="$WORK_DIR/npm-cache" npm ci --omit=dev --ignore-scripts --prefix "$WORK_DIR/app"
node --check "$WORK_DIR/app/server.js"
for file in "$WORK_DIR/app"/*.js "$WORK_DIR/app"/routes/*.js; do node --check "$file"; done
if [[ -f "$APP_DIR/.env" ]]; then cp -p "$APP_DIR/.env" "$WORK_DIR/app/.env"; fi
visudo -cf "$WORK_DIR/app/deploy/mymusics-update.sudoers"

write_status installing "$TAG" "Installing $TAG."
BACKUP=$(mktemp -d /opt/mymusics.previous.XXXXXX)
rmdir "$BACKUP"
mv "$APP_DIR" "$BACKUP"
OLD_MOVED=1
mv "$WORK_DIR/app" "$APP_DIR"
install -m 0755 "$APP_DIR/deploy/mymusics-update.sh" /usr/local/sbin/mymusics-update
install -m 0644 "$APP_DIR/deploy/mymusics.service" /etc/systemd/system/mymusics.service
install -m 0644 "$APP_DIR/deploy/mymusics-update.service" /etc/systemd/system/mymusics-update.service
install -m 0440 "$APP_DIR/deploy/mymusics-update.sudoers" /etc/sudoers.d/mymusics-update
visudo -cf /etc/sudoers.d/mymusics-update
systemctl daemon-reload

write_status restarting "$TAG" "Restarting MyMusics."
FAIL_MESSAGE="Updated files failed the startup health check; the previous version was restored."
systemctl restart mymusics.service
systemctl is-active --quiet mymusics.service
healthy=0
for _ in {1..960}; do
  if health=$(curl -fsS --connect-timeout 2 --max-time 3 http://127.0.0.1:6565/health 2>/dev/null); then
    if printf '%s' "$health" | EXPECTED_VERSION="$TAG" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const h=JSON.parse(s);if(h.status==="ok"&&h.version===process.env.EXPECTED_VERSION)process.exit(0)}catch{}process.exit(1)})'; then
      healthy=1
      break
    fi
  fi
  sleep 1
done
[[ "$healthy" == 1 ]]

write_status complete "$TAG" "Updated to $TAG."
OLD_MOVED=0
rm -rf -- "$BACKUP" || true
BACKUP=
