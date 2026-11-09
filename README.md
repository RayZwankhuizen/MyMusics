# MyMusics

MyMusics is a self-hosted web radio player and station library. Play internet radio in a browser, organize stations by genre, keep a separate Favorites list, and manage the library from a second page. The app runs on Node.js and stores its station data in `stations.json` in the configured data directory.

MyMusics currently connects to a Jellyfin server for personal music playback. Browse and search tracks, albums, artists, genres, and playlists; build an automatic DJ queue; and play through the browser or the MyMusics host. The radio and music libraries remain separate, and Jellyfin credentials stay on the server.

MyMusics is completely vibe-coded.

## Features

- Play MP3 streams and HLS (`.m3u8`) streams.
- Browse stations by genre or mark stations as favorites.
- Add, rename, move, and delete stations. Create, rename, and delete genres.
- Find stations in the Radio Browser directory by music tag and optional country code, then add selected results to a genre.
- Add local PNG, JPEG, or WebP station logos. Logos are removed when no station references them and are excluded from Git.
- Use the in-app Help page for step-by-step instructions for player and library features.
- Show now-playing information when a stream provides metadata, with album details and artwork when available.
- Display plain or synchronized lyrics when a match is available from the supported lyric services.
- Use an equalizer on streams that allow browser audio analysis. Playback still works when a stream blocks analysis.
- Automatically fade the volume down while speech or ads are detected on compatible MP3 streams; set the target volume per station.

Metadata, artwork, and lyrics depend on the stream and third-party services; they may be unavailable for some tracks. Genius artwork lookup is optional and requires an API token.

## Requirements

- Node.js 18 or newer
- npm
- An internet connection to reach radio streams and metadata services

## Install and run

```sh
git clone https://github.com/RayZwankhuizen/MyMusics.git
cd MyMusics
npm ci
npm start
```

Open [http://localhost:8080](http://localhost:8080) and choose a genre or a station. The server listens on port `8080` by default. Set `PORT` or `HOST` to use a different port or network interface, for example:

```sh
HOST=127.0.0.1 PORT=8081 npm start
```

## Ubuntu runtime deployment

The tagged GitHub releases include `mymusics.tar.gz`, a runtime package with the server, browser files, dependencies manifest, initial station list, version/build date, and systemd update files. The Ubuntu server does not need a Git checkout. It does need these runtime files to run the app.

Install Node.js 18 or newer, then create a dedicated service account and directories:

```sh
node --version # must be v18 or newer
sudo useradd --system --home /var/lib/mymusics --shell /usr/sbin/nologin mymusics
sudo mkdir -p /opt/mymusics /etc/mymusics
sudo chown root:root /opt/mymusics
sudo mkdir -p /var/lib/mymusics

# For an existing installation, preserve its data before replacing /opt/mymusics.
if [ -f /opt/mymusics/stations.json ] && [ ! -e /var/lib/mymusics/stations.json ]; then
  sudo cp -a /opt/mymusics/stations.json /var/lib/mymusics/stations.json
fi
if [ -d /opt/mymusics/data/station-images ] && [ ! -e /var/lib/mymusics/station-images ]; then
  sudo cp -a /opt/mymusics/data/station-images /var/lib/mymusics/station-images
fi
sudo chown -R mymusics:mymusics /var/lib/mymusics
```

Download and install the latest package from the GitHub repository:

```sh
cd /tmp
curl -fL https://github.com/RayZwankhuizen/MyMusics/releases/latest/download/mymusics.tar.gz -o mymusics.tar.gz
sudo tar -xzf mymusics.tar.gz -C /opt/mymusics
sudo npm ci --omit=dev --prefix /opt/mymusics
sudo install -m 0644 /opt/mymusics/deploy/mymusics.service /etc/systemd/system/mymusics.service
sudo install -m 0755 /opt/mymusics/deploy/mymusics-update.sh /usr/local/sbin/mymusics-update
sudo install -m 0644 /opt/mymusics/deploy/mymusics-update.service /etc/systemd/system/mymusics-update.service
sudo install -m 0440 /opt/mymusics/deploy/mymusics-update.sudoers /etc/sudoers.d/mymusics-update
sudo visudo -cf /etc/sudoers.d/mymusics-update
sudo systemctl daemon-reload
sudo systemctl enable --now mymusics
```

The systemd unit sets `MYMUSICS_DATA_DIR=/var/lib/mymusics`. On first start, MyMusics copies the packaged `stations.json` into that directory if no persistent copy exists. If an older installation has station logos in `/opt/mymusics/data/station-images/`, they are copied to `/var/lib/mymusics/station-images/` when that persistent logo directory does not exist. The service account owns `/var/lib/mymusics` through systemd's `StateDirectory` setting.

For a private GitHub repository, create a fine-grained personal access token limited to this repository with **Contents: read-only** permission. Add `GITHUB_ACCESS_TOKEN=YOUR_TOKEN` to `/etc/mymusics/mymusics.env`, then protect the file and restart the services:

```sh
sudo chown root:mymusics /etc/mymusics/mymusics.env
sudo chmod 0640 /etc/mymusics/mymusics.env
sudo systemctl daemon-reload
sudo systemctl restart mymusics
```

The app and updater read the token from that file to check and download private releases. Do not commit the token or paste it into chat.

Open `http://<ubuntu-ip>:6565` on your network. To configure optional secrets such as `GENIUS_ACCESS_TOKEN`, put them in `/etc/mymusics/mymusics.env` as `KEY=value`, then run `sudo systemctl restart mymusics`.

Station settings and uploaded logos live in `/var/lib/mymusics`, outside the release directory, and survive package updates. The updater installs dependencies in its temporary `/opt` workspace and keeps npm's cache there too, so it does not need access to `/root/.npm`. It validates the release tag and required runtime files, checks JavaScript syntax, and verifies that the restarted app reports the expected version at `/health`. If installation or the health check fails, it restores the previous package and service files and records a failed update status. After the updater files and sudoers rule are installed, open **Manage** to see the installed version and build date, check GitHub for a release, then select **Install and restart** to download and install it. The player restarts during the update. Create and push a new `v*` Git tag to publish a release. Back up `/var/lib/mymusics` separately. For the first install of this data-directory version, copy existing `/opt/mymusics/stations.json` and logos to `/var/lib/mymusics` before extracting the release; if a previous release already overwrote that file, restore it from backup first.

## Use the player

1. Choose a genre in the left sidebar, then select **Play** beside a station.
2. Use **Search stations** above the list on Listen or Manage to filter by name.
3. Select the star to add a station to or remove it from **Favorites**. Favorites are also shown in their regular genre.
4. Select **Edit** above the station list to show an edit button beside each station. Use it to rename, move, or delete that station.
5. Use **Manage** in the sidebar to add stations and organize genres. When deleting a genre, its stations are deleted with it.
6. Use the player controls for playback. Lyrics appear when a match is available; synchronized lyrics follow the track when timing data is provided. The equalizer and automatic speech/ad volume controls are available only when the stream and browser support the required audio processing.

## Add or organize stations

Open **Manage** from the sidebar.

- Choose a genre to add a station to it, or create a genre in **Organize genres**.
- Enter the station name and stream URL, then select **MP3 / audio stream** or **HLS (.m3u8)**.
- Use **Find and preview streams** beside the URL field to search a station name and compare up to 10 available candidates before choosing one.
- A URL without a scheme is saved as HTTPS. Enter `http://` explicitly for an HTTP stream.
- Use a station's edit controls to change its details or move it to another genre.
- Add an optional PNG, JPEG, or WebP logo (up to 2 MB) in the station editor. Logos are stored in the configured data directory's `station-images/` folder (`/var/lib/mymusics/station-images/` for the Ubuntu service).
- Search the station directory by optional country code (`NL`, `US`, `GB`, `ES`, etc.) and music tag (`rock`, `pop`, etc.). Omit the country to search worldwide. Leave the tag blank or enter `all` to browse all styles in a selected country, then add results individually to a matching genre.
- Deleting a genre also deletes every station in it and requires confirmation.

Station and genre changes are saved to `stations.json` in the configured data directory and remain after the server restarts. In the Ubuntu service they are stored in `/var/lib/mymusics/stations.json`; back up that file and the sibling `station-images/` directory.

## Optional Genius artwork

MyMusics first looks for album artwork in Cover Art Archive. To enable a Genius artwork fallback:

1. Create an API client at [genius.com/api-clients](https://genius.com/api-clients).
2. Create a `.env` file in the project root with:

   ```env
   GENIUS_ACCESS_TOKEN=your-client-access-token
   ```

3. Restart MyMusics.

Keep `.env` private. It is ignored by Git. Genius lookup is disabled when no token is configured.

## Music mode (Jellyfin)

Music mode requires Jellyfin to remain installed and running on your media server. MyMusics connects to it over the network; if Jellyfin runs on the same Ubuntu machine, use `http://127.0.0.1:8096`. Set `JELLYFIN_URL` to the address reachable from the MyMusics service.

`/music.html` adds a second mode next to the radio stations: an endless DJ queue built from your own Jellyfin music library. Radio stations and the music mode stay separate; both are reached from the mode switch at the top of the sidebar.

Both pages let you choose **This browser** or **MyMusics host** as the audio output. Browser output is the default. Host output uses MPV on the MyMusics server and plays through the audio device available to the `mymusics` service account; install MPV on that host and configure the service account to access its headphone/aux output. Radio metadata and Jellyfin playback remain server-proxied. Browser EQ and speech detection are unavailable with host output.

To enable Music mode, set `JELLYFIN_URL` and `JELLYFIN_API_KEY` in `/etc/mymusics/mymusics.env` (or `.env` when running from the project directory). `JELLYFIN_USER_ID` is optional:

```env
JELLYFIN_URL=http://jellyfin.local:8096
JELLYFIN_API_KEY=your-api-key
JELLYFIN_USER_ID=your-user-id
```

Create the API key in Jellyfin under **Dashboard → API Keys**. `JELLYFIN_USER_ID` is optional: MyMusics picks the first enabled user itself and sends it with every request, because Jellyfin 12 refuses item and audio requests without one. Set it only to pin a specific account.

How it works:

- `GET /api/music/search?q=&type=all|track|artist|album|genre|playlist` searches your library. `all` merges playlists, tracks, albums, artists, and genres. Leave `q` empty with `all`, `artist`, `genre`, or `playlist` to list them (All lists up to 300 artists).
- Playlists are stored in `music-playlists.json` next to `stations.json` (so `/var/lib/mymusics/music-playlists.json` on the Ubuntu service) and are managed with `GET`/`POST /api/music/playlists`, `GET`/`PATCH`/`DELETE /api/music/playlists/:id`, and `POST /api/music/playlists/:id/tracks` / `DELETE /api/music/playlists/:id/tracks/:index`. They live in MyMusics, not in Jellyfin; back the file up with the rest of the data directory.
- `GET /api/music/album/:id` returns an album's tracks in disc order, and `GET /api/music/seed?artistId=|genre=` picks one random track to seed a DJ queue from an artist or a genre.
- `GET /api/music/info?kind=track|album|artist|genre|playlist&id=` returns the detail fields shown in the Info tile (artist, album, genre, year, length, counts) plus the items behind those counts: `tracks` for albums, genres and playlists, and `albums` + `tracks` for artists.
- `GET /api/autodj/next?seed=&exclude=&artists=&limit=` returns the next queue slice. Similar tracks come from Jellyfin's Instant Mix for the seed track, then the seed's genre, then the whole library. Tracks and artists heard recently are filtered out.
- `/library/audio/:id` and `/library/art/:id` proxy the audio stream (including range requests, so seeking works) and cover art through this server. The API key never reaches the browser, and the audio stays same-origin so the equalizer and visualizer keep working.
- Add `?transcode=1` to `/library/audio/:id` to have Jellyfin convert the track to MP3 (192 kbit/s). Music mode asks for this itself when the browser reports it cannot decode a track's container, which is what lets a FLAC library play on a TV or Fire TV stick. A converted stream ignores range requests, so it cannot be seeked — the original file is used whenever the browser accepts it.

The queue, history, and no-repeat list live in the browser (`mymusics:dj-*` in localStorage), so the server stays stateless. Nothing in music mode needs an MPD or Liquidsoap server.

## Network and access

By default, the server listens on all network interfaces. Anyone who can reach it can use station and genre management and trigger an update from the published GitHub releases. Keep it on a trusted network; bind to `127.0.0.1` with `HOST=127.0.0.1` when it should only be available on the same machine. Do not expose it directly to the public internet without adding access protection.
