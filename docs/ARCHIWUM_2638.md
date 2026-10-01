# Korekta archiwum 2638 — 01.10.2026

Poziom wyniku: **przygotowane i zweryfikowane lokalnie**. Odbiór redakcyjny
nie jest zgodą właściciela na publikację. Bieżącym wydaniem pozostaje 2640.

## Paczka do odbioru

- Dokument publiczny: `weekly/public/2638.json`, 32 potwierdzone pozycje i 3
  oczekujące; stan redakcyjny `active`, stan datowany strony `ended`.
- Historyczny dokument aplikacji: `weekly/2026-09-17.json`, 41 pozycji.
  Nie zastępuje `weekly/latest.json` ani produkcyjnego `weekly:latest`.
- Odbiór: `reviews/2638-archive.json`, pełne `checkedFactIds`, mapowanie
  identyfikatorów obu kanałów i ograniczenia źródeł.
- Potwierdzenie i weryfikacja: `2026-10-01T21:36:06.617Z`.
  Odbiór dokładnych bajtów: `2026-10-01T21:39:30.295Z`.
- `publicSha256`: `a23a48d6431d846e4b61102f7b4e39b4ae7fcf9ffe205e99c05d38bd51e38d44`.
- `appSha256`: `86d551dfdf4865e28fc21f4e64b574f2379a7e2499758cb675ce49c1c2d26abe`.

Przygotowanie wyłącznie archiwalnego klucza:

```sh
node scripts/prepare-public-weekly.mjs weekly/public/2638.json \
  --app weekly/2026-09-17.json --review reviews/2638-archive.json \
  --target archive --output /tmp/2638-archive-kv.json
```

Plik wynikowy zawiera dokładnie jeden zapis: `weekly:public:2638`.
Istniejący plik wyjściowy należy zachować; skrypt celowo go nie nadpisuje.
Każda zmiana dokumentu publicznego lub aplikacji wymaga nowego odbioru.

## Fakty i granice źródeł

Uzupełniono pozostałe rabaty, test rides/HSW, oba salony, Salvage Yard,
wyścigi i próby czasowe, cele Kortz Center oraz ogólną sprzedaż Horus.
Ponownie sprawdzono podium i wygraną Prize Ride przez cztery kolejne dni.
Gun Van obejmuje sześć broni, trzy materiały miotane i pięć rodzajów pancerza,
z oddzielnymi rabatami podstawowymi i GTA+.

Podstawą miesięcznych okresów, wyzwania i późniejszego odbioru nagrody są
datowane artykuły Rockstar Business Rivalries z 03.09 i GTA+ z 10.09,
ponownie odczytane przez istniejący GraphQL. Lista Newswire nie zawierała
osobnego wpisu 17.09. Rotacje uzgodniono z datowanymi RockstarINTEL,
GTABase i iGrandTheftAuto. Karta Horus w GTABase potwierdza cenę i ogólną
sprzedaż od 17.09. Tygodniowy tekst GTABase zachowuje starszą zapowiedź;
nie przeniesiono jej jako bieżącego faktu. Adresy i czasy odczytów są w JSON.

Pełne podstawowe rabaty Gun Van i pancerze mają jedno odczytane źródło:
RockstarINTEL. Oznaczenie aplikacji `editorial` uwidacznia tę granicę;
pozostałe źródła potwierdzają skład broni i wyróżnione rabaty. Dokładnego
dziennego postoju nie weryfikowano i nie wpisano współrzędnych.

Oczekujące dane pozostają `pending`:

- `community-mission-selection`: dokładny wybór misji Community.
- `salvage-yard-claimability`: możliwość zachowania samochodów na własność.
- `kortz-completion-bonuses`: reset pierwszego ukończenia i premia bez śmierci.

Usunięte duplikaty aplikacji: `auto-b9d815110373ec3474` (Grapeseed Bunker
w rabatach) i `gta-plus-2026-09-shotaro` (model już w rabacie zbiorczym).
Pozostałe istniejące identyfikatory zachowano. GTA+ kończy się 07.10;
La Coureuse ma kwalifikację do 23.09 i osobny odbiór 24–30.09.

## Odbiór techniczny

- Baza `npm test`: 115/115; korekta: **116/116**.
- Walidacja obu dokumentów, rzeczywisty parser `src/content/types.ts`
  aplikacji oraz integralność SHA-256 poprawne. Zmiana bajtów unieważnia odbiór.
- Historyczne testy zegara używają stałej zapowiedzi w
  `tests/fixtures/public-weekly-2638-preview.json`; korekta ma osobny test.
- Chrome komputer i 390 px: daty, źródła, kotwice, sześć tabel i komunikat
  „Edition ended” poprawne. Dokument przy 390 px nie wychodzi poza ekran;
  przewijanie tabel działa.
- Lokalne HTTP: 12/12. Produkcyjne HTTP przed korektą: 12/12, w tym
  2638/2637/2640, 301, 404 i 401 chronionego API.
- Odczyt produkcji 21:42:10 UTC: bieżące 2640 ma rewizję
  `551ee51ac383fee3f2d301e0b17505a6705434854e59d0048e48b4f7dccd72de`;
  naturalny przebieg 21:31:18 UTC ją zachował, alarm wyłączony.
  Nie dowodzi to jeszcze trwałości nieopublikowanej korekty 2638.

## Publikacja po osobnej zgodzie

Przed zapisem ponownie odczytaj KV i porównaj dokładne bajty ze stanem
zachowanym do cofnięcia. Wcześniejszy `weekly:public:2638` ma SHA-256
`61124955d26bce215c4b7a9ecd80d7680f4534c5ea04c5dec2a88b17b52f0e73`.
Rozbieżność wymaga ponownego porównania zmian; nie nadpisuj jej automatycznie.
Sprawdź także aktualne 2640. Zapis i ewentualne cofnięcie obejmują wyłącznie
`weekly:public:2638`; nie wymagają deployu ani zmiany kontraktów API.

Po zapisie sprawdź zgodność odczytu z artefaktem, oba starsze artykuły,
ochronę API i naturalny przebieg automatu. Dopiero wtedy odnotuj publikację,
rozstrzygnij kryteria historycznego #28 i odhacz istniejące przypomnienie.
Nie oznaczaj oczekujących faktów jako potwierdzonych ani całego #10 jako
ukończonego. Rejestr napraw: https://github.com/gontii/gtacompanion/issues/10;
historyczny odbiór: https://github.com/gontii/gta-companion-content/issues/28.
