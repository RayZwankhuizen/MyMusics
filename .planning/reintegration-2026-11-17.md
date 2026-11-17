# Herintegratie lokale verbeteringen

Goedgekeurd: testisolatie, YouTube-dialogen/paginering, hostsynchronisatie, native fetch en help/tests terugbouwen bovenop GitHub 1.0.40. Jellyfin, vergelijkbare-artiesten-AutoDJ, mediabeheer en speelduur behouden. Geen release of push.

1. Testisolatie: bestaande negen Jellyfin-tests.
2. YouTube: API- en browsertests inclusief paginering, speelduur, mobiel en TV/Silk.
3. Hostsynchronisatie: unit-, route- en browsertests.
4. Fetch: streaming-, logo- en Jellyfin-tests, inclusief nieuwe DELETE-route.
5. Volledige testsuite, lint op gewijzigde JS, diffcontrole en metadata.

Baseline: 48/53 tests geslaagd; vijf fouten door persoonlijke Jellyfin-instellingen.

Uitgevoerd: 71/71 tests groen. Alle vijf onderdelen ingebouwd; externe bibliotheekversies en playlistdata buiten scope gehouden. Echte YouTube/MPV-weergave nog handmatig te beoordelen.
