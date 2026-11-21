#!/usr/bin/env bash
set -u

export DEBIAN_FRONTEND=noninteractive
if ! command -v -- mpv >/dev/null 2>&1 || ! command -v -- yt-dlp >/dev/null 2>&1 || ! command -v -- ffmpeg >/dev/null 2>&1 || ! /usr/bin/python3 -m venv --help >/dev/null 2>&1; then
  if ! /usr/bin/apt-get -o DPkg::Lock::Timeout=600 -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update; then
    /usr/bin/logger -t mymusics "Could not update apt package lists for host playback and audio analysis."
    exit 0
  fi
  if ! /usr/bin/apt-get -o DPkg::Lock::Timeout=600 -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 install -y --no-install-recommends mpv yt-dlp ffmpeg python3-venv; then
    /usr/bin/logger -t mymusics "Could not install host audio analysis packages from the configured apt repositories."
    exit 0
  fi
fi
if [ ! -x /opt/mymusics/venv-audio/bin/python3 ] || ! /opt/mymusics/venv-audio/bin/python3 -c 'import numpy, mediapipe' >/dev/null 2>&1; then
  /usr/bin/python3 -m venv /opt/mymusics/venv-audio
  /opt/mymusics/venv-audio/bin/python3 -m pip install --disable-pip-version-check numpy >/dev/null 2>&1 || /usr/bin/logger -t mymusics "Could not install NumPy for host audio visualization."
  /opt/mymusics/venv-audio/bin/python3 -m pip install --disable-pip-version-check 'mediapipe==0.10.35' >/dev/null 2>&1 || /usr/bin/logger -t mymusics "Could not install optional MediaPipe radio classifier; host waveform and spectrum may remain available."
fi
if ! command -v -- mpv >/dev/null 2>&1; then
  /usr/bin/logger -t mymusics "The mpv package installed, but its executable is unavailable."
fi
if ! command -v -- yt-dlp >/dev/null 2>&1; then
  /usr/bin/logger -t mymusics "The yt-dlp package installed, but its executable is unavailable; YouTube host playback will not work."
fi
