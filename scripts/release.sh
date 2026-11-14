#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

branch=$(git branch --show-current)
[[ -n "$branch" ]] || { echo "Detached HEAD; check out the release branch first." >&2; exit 1; }

current=$(node -p "require('./package.json').version")
[[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || { echo "Expected a numeric x.y.z package version." >&2; exit 1; }
suggested="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$((BASH_REMATCH[3] + 1))"
read -rp "Commit message: " message
[[ -n "$message" ]] || { echo "Commit message is required." >&2; exit 1; }
read -rp "Version [$suggested]: " version
version=${version:-$suggested}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Expected a numeric x.y.z version." >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$version" >/dev/null && { echo "Tag v$version already exists." >&2; exit 1; }

npm version "$version" --no-git-tag-version
build_date=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
printf '%s\n' "$build_date" > BUILD_DATE
node -e 'const fs=require("node:fs");fs.writeFileSync("public/app-info.json",JSON.stringify({version:require("./package.json").version,date:fs.readFileSync("BUILD_DATE","utf8").trim()})+"\n")'

echo "Run 'npm run test' now."
read -rp "Type 'test is groen' to commit and push: " confirmation
[[ "$confirmation" == "test is groen" ]] || { echo "Stopped; nothing committed or pushed."; exit 1; }

git add -A
git commit -m "$message"
git tag "v$version"
git push origin "$branch" "refs/tags/v$version"
