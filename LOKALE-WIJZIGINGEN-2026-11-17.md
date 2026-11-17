# Lokale wijzigingen vóór GitHub-update — 17 november 2026

## Status en herstelpunten

De lokale `main` is bijgewerkt naar `origin/main`: `4f5923b1568ce3442e7e6890dc104cfbc5789629` (versie 1.0.40). Er zijn geen lokale applicatiewijzigingen opnieuw toegepast. Alleen dit verslag is aan de werkmap toegevoegd. Er is niets gepusht.

- Oorspronkelijke lokale commit: `688f1c405ef5c91a9516cba8e1b0a50ef50f25fe` (`Youtube finetuning`, versie 1.0.39).
- Bewaarde branch: `backup/local-2026-11-17`.
- Gemeenschappelijke basis met GitHub: `fca4b923775020ddbd0ec3a69556be0a1155755e`.
- Losse wijzigingen: stash `Lokale wijzigingen voor GitHub-update 2026-11-17`, object `4081c09b72b67815183edccb301c29d11261280b`.
- De oudere stash van 16 november is behouden.
- Aanvullende patches en kopie van videoplaylists: `/tmp/mymusics-backup-2026-11-17/`. Tijdelijke bestanden zijn geen duurzame back-up; branch en stash blijven in deze Git-repository beschikbaar.

Gebruik bij herstel de stashnaam/object-ID: de nummering van stashes kan later veranderen. Niet de volledige oude branch of stash over de nieuwste code zetten; onderstaande onderdelen gericht combineren.

## Lokale applicatiewijzigingen die op GitHub ontbreken

### YouTube zoeken en wachtrij

- Zoekresultaten en wachtrij openen in aparte dialoogvensters met grotere afbeeldingen en bediening.
- Paginering voor zowel videozoekopdrachten als YouTube-playlists, inclusief knop voor meer resultaten.
- Zoekstatus, sluiten en verplaatsen van bestaande bediening naar de dialoogvensters.
- Betrokken bestanden: `public/video-options.js`, `public/video-options.css`, `public/youtube.html`, `routes/videos.js`.
- Extra tests: `test/video-search-api.test.js`, `test/youtube-browser.test.js`.
- Advies: opnieuw combineren met GitHub. De nieuwe GitHub-code voor speelduur behouden.

### YouTube-beeld en hostgeluid synchroniseren

- Nieuwe module `public/youtube-host-sync.mjs` voor afstemming tussen browserbeeld en MPV-hostgeluid.
- Hostvideo gepauzeerd voorbereiden; positie, pauze en afspeelsnelheid afstemmen.
- Video-ID en sessiecontrole voorkomen dat verouderde videobesturing een nieuwe sessie beïnvloedt.
- Hostspeler herstelt afspeelsnelheid bij laden en ruimt toestand bij bronwissels op.
- Betrokken bestanden: `host-player.js`, `routes/host-player.js`, `public/video-options.js` en de nieuwe synchronisatiemodule.
- Tests: `test/youtube-host-sync.test.js` en aanvulling op `test/routes.test.js`.
- Advies: gericht opnieuw toepassen en testen met browser en MPV; GitHub bevat deze implementatie niet.

### Ingebouwde Node-fetch

- `node-fetch` verwijderd uit package.json en lockbestand; gebruik van `globalThis.fetch`.
- Time-outs via abortsignalen; muziekstreams begrenzen alleen de verbindingsopbouw.
- Webstreams naar Node-streams omzetten voor audio- en afbeeldingsproxy's.
- ICY-verbindingen via AbortController beëindigen.
- Logo-ophalen via ingebouwde HTTP(S)-client met DNS-pinning, redirectcontrole en begrenzing van de uitgepakte respons.
- Betrokken: Jellyfin-client, metadata-, update-, radio-, muziekmedia- en zenderzoekroutes.
- Tests: `test/native-fetch.test.js` en aangepaste proxytests.
- Advies: opnieuw combineren als de migratie gewenst blijft. GitHub gebruikt nog node-fetch. De nieuwe Jellyfin-verwijderfunctie op GitHub ook meenemen in een eventuele migratie.

### Testisolatie van persoonlijke Jellyfin-instellingen

- Tijdens import tijdelijk `storage.readJellyfinSettings` vervangen, daarna herstellen.
- Voorkomt dat lokaal opgeslagen instellingen de testconfiguratie overschrijven.
- Betrokken: `test/jellyfin-autodj.test.js`, `test/jellyfin-catalog.test.js`.
- Advies: opnieuw toepassen. De fetchmock aanpassen aan de uiteindelijk gekozen fetch-client; GitHub heeft inmiddels `ArtistItems` aan de verwachte catalogusvelden toegevoegd, dat behouden.

### Externe browserbibliotheken

- HLS.js vastgezet op 1.7.4 in radioweergave en beide Management-voorbeelden, in plaats van `@1`.
- ONNX Runtime Web van 1.22.0 naar 1.31.1, inclusief WASM-basispad.
- Advies: afzonderlijk beoordelen en verifiëren; geen versies blind terugzetten.

### Documentatie en lokale data

- Help uitgebreid voor YouTube-zoeken, dialoogvensters en hostweergave.
- Oud verslag `LOKALE-WIJZIGINGEN-2026-11-16.md` toegevoegd; het bevat historische informatie en geldt niet als huidige inventaris.
- `video-playlists.json` lokaal uit Git verwijderd en aan `.gitignore` toegevoegd. GitHub volgt het bestand nog. Dit betreft gebruikersdata, geen verwijdering van playlistfunctionaliteit.
- Een kopie van de lokale videoplaylists is beschikbaar in de tijdelijke back-upmap; niet automatisch teruggezet over GitHub-data.
- Advies: help bijwerken nadat functionele keuzes vaststaan; apart beslissen over het volgen van videoplaylistdata.

## Vier niet-gecommitte wijzigingen vóór het bijwerken

1. `public/video-options.css`: TV/Silk-dialoogbreedte `min(1350px,92vw)`, maximale hoogte `90vh`, centreren en actieknoppen minimaal 48px breed.
2. `test/youtube-browser.test.js`: extra controle bij 1280×720 in TV/Silk-modus op vensterbreedte, afbeeldingen van minimaal 190px en sluiten met Escape.
3. `BUILD_DATE`: van `2026-11-16T16:21:00Z` naar `2026-11-16T16:21:56Z`.
4. `public/app-info.json`: dezelfde datumwijziging; versie bleef 1.0.39.

De CSS- en testwijzigingen horen bij de lokale YouTube-dialoogimplementatie. Alleen opnieuw toepassen als die terugkomt. Oude builddatums en versie niet herstellen; bij toekomstige applicatiewijzigingen nieuwe metadata maken volgens AGENTS.md.

## GitHub-functionaliteit die bij samenvoegen behouden moet blijven

- AutoDJ met vergelijkbare artiesten.
- Jellyfin-mediabeheer: duplicaten zoeken, kopieën selecteren en verwijderen, met bevestiging en controles op een te behouden exemplaar.
- Inklapbare Management-navigatie.
- YouTube-speelduur in resultaten en playlists, inclusief ophalen van contentDetails via de API.
- Versie 1.0.40 en aanpassingen aan releasescript/README.

De oude lokale bestanden bevatten deze functies niet. Hun afwezigheid in de diff is geen lokale reparatie die moet worden hersteld.

## Verificatie

Dit is een broncode-inventaris, geen functionele hertest. Na het bijwerken is HEAD gelijk aan origin/main. Back-upbranch en stash zijn gecontroleerd. Geen applicatiecode aangepast, geen tests uitgevoerd en geen wijzigingen gepusht.

## Bestanden in de lokale commit ten opzichte van de gemeenschappelijke basis

```
M	.gitignore
M	BUILD_DATE
A	LOKALE-WIJZIGINGEN-2026-11-16.md
M	host-player.js
M	jellyfin.js
M	package-lock.json
M	package.json
M	public/app-info.json
M	public/help.html
M	public/manage-station-preview.mjs
M	public/manage-stream-finder.mjs
M	public/radio-hls-playback.mjs
M	public/radio-speech-detector.mjs
M	public/video-options.css
M	public/video-options.js
A	public/youtube-host-sync.mjs
M	public/youtube.html
M	routes/host-player.js
M	routes/jellyfin-settings.js
M	routes/metadata-providers.js
M	routes/metadata.js
M	routes/music-media.js
M	routes/now-playing.js
M	routes/radio-stream.js
M	routes/station-discovery.js
M	routes/updates.js
M	routes/videos.js
M	test/jellyfin-autodj.test.js
M	test/jellyfin-catalog.test.js
A	test/native-fetch.test.js
M	test/routes.test.js
A	test/video-search-api.test.js
A	test/youtube-browser.test.js
A	test/youtube-host-sync.test.js
D	video-playlists.json
```


## Herintegratie uitgevoerd op 17 november 2026

Bovenstaande inventaris blijft het historische herstelpunt van vóór de herintegratie. Inmiddels opnieuw ingebouwd: Jellyfin-testisolatie; YouTube-zoek- en wachtrijvensters met mobiel/TV/Silk-aanpassingen; video- en playlistzoekpaginering; browser/MPV-hostsynchronisatie met sessiecontrole; ingebouwde Node-fetch met streams, time-outs en DNS-pinning; bijgewerkte help en regressietests.

GitHub-functionaliteit behouden: vergelijkbare-artiesten-AutoDJ, duplicatenbeheer, Management-navigatie en YouTube-speelduur. De nieuwe Jellyfin-DELETE-functie gebruikt eveneens ingebouwde fetch met abortdeadline. De HLS/ONNX-versies en het volgen van video-playlists.json zijn ongewijzigd gebleven.

Verificatie: alle 71 tests slagen, inclusief extra controles op vergelijkbare artiesten, DELETE-authenticatie/time-out, speelduur in zoek- en wachtrijvensters en de video-details-API. Biome 2.6.7 controleert de gewijzigde JS-bestanden; één callback is daarvoor aangepast. Browserbeelden voor mobiel en desktop zijn bekeken. Echte YouTube/MPV-audioweergave is niet getest; de synchronisatietests gebruiken mocks. Buildmetadata bijgewerkt, versie 1.0.40 behouden. Geen commit, push of release uitgevoerd.
