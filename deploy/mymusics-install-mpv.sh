#!/usr/bin/env bash
set -u

if command -v -- mpv >/dev/null 2>&1; then
  exit 0
fi
if /usr/bin/dpkg-query -W -f='${Status}' mpv 2>/dev/null | /usr/bin/grep -q 'install ok installed'; then
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
if ! /usr/bin/apt-get -o DPkg::Lock::Timeout=600 -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update; then
  /usr/bin/logger -t mymusics "Could not update apt package lists to install mpv."
  exit 0
fi
if ! /usr/bin/apt-get -o DPkg::Lock::Timeout=600 -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 install -y --no-install-recommends mpv; then
  /usr/bin/logger -t mymusics "Could not install mpv from the configured apt repositories."
  exit 0
fi
if ! command -v -- mpv >/dev/null 2>&1; then
  /usr/bin/logger -t mymusics "The mpv package installed, but its executable is unavailable."
fi
