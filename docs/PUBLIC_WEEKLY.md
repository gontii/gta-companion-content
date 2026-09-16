# Publiczny Weekly Update

## Dokumenty i adresy

- Treść wydania: `weekly/public/YYWW.json`. Numer pochodzi z roku i tygodnia ISO daty rozpoczęcia; `weekId` pozostaje datą. Korekta nie zmienia numeru.
- Główna strona: `/gta-online/weekly-update`, z aktualnie wybranym wydaniem lub zapowiedzią.
- Osobny artykuł: `/gta-online/weekly-update/YYWW`. Zachowuje własny canonical i daty; po zakończeniu okresu wyświetla komunikat o wygaśnięciu.
- Indeks opublikowanych osobnych wydań: `weekly/public/index.json`. Wpis zawiera wyłącznie `issue`, `startsOn`, `endsOn`. Nie dodawaj nieopublikowanego wydania.
- Publiczne archiwum zostało zaakceptowane przez Przemka 16.09.2026; zastępuje wcześniejszą zasadę braku archiwum. W pierwszej publikacji główna strona pokazuje zapowiedź 2638, a osobny artykuł 2637 opisuje 10–16.09.

Publicznie pokazujemy wszystkie potwierdzone fakty, warunki, daty i źródła. Rekomendacje, checklisty i postęp pozostają w aplikacji. Nie kopiuj aplikacyjnego `weekly/latest.json` do publicznego dokumentu.

Szablon krok po kroku: [templates/PUBLIC_WEEKLY.md](../templates/PUBLIC_WEEKLY.md). Kontrakt: `schemas/public-weekly.mjs`; aplikacja używa przypiętej kopii z kontrolą SHA-256.

## Klucze KV i walidacja

`weekly:public` zawiera pojedynczy dokument albo wersję 2: `{schemaVersion: 2, current: dokument, archive: indeks}`. Każdy osobny artykuł ma klucz `weekly:public:YYWW`. Zmiana głównego wydania nie usuwa wcześniejszych kluczy. HTML i sitemap korzystają wyłącznie z walidowanych danych publicznych; nie ma publicznego API JSON. `weekly:latest` nadal należy do chronionej aplikacji.

```sh
npm test
node scripts/prepare-public-weekly.mjs weekly/public/2638.json \
  --archive-index weekly/public/index.json --output /tmp/2638-public-kv.json
```

To przygotowanie lokalne, bez wysyłki i bez nadpisywania istniejącego pliku wyjściowego. Stary format dwóch wydań pod jednym adresem pozostaje odczytywalny dla zgodności, lecz nie służy do nowych publikacji.

## Odbiór aktywnego wydania

1. Po aktualizacji gry odczytaj źródła i sprawdź rotacje. Niepotwierdzone pozycje zostaw `pending`.
2. Zaktualizuj dokument publiczny i aplikacji. Porównaj kwoty, mnożniki, warunki, platformy, nagrody, daty i okna odbioru. Dla GTA+ sprawdź osobny okres oraz krótsze wyjątki.
3. Ustaw `status: active`, rzeczywisty `confirmedAt` po rozpoczęciu okresu oraz `verifiedAt` nie wcześniejszy niż potwierdzenie.
4. Zapisz plik odbioru poza publicznym HTML: `status: zatwierdzone`, `publicSha256`, `appSha256`, `reviewedAt` w UTC oraz `checkedFactIds` wszystkich potwierdzonych pozycji. Skróty dotyczą dokładnych bajtów plików. Odbiór znaczenia jest redakcyjny; skróty go nie zastępują.

```sh
node scripts/prepare-public-weekly.mjs weekly/public/2637.json \
  --app weekly/2026-09-10.json --review /tmp/2637-odbior.json \
  --target archive --output /tmp/2637-archive-kv.json
```

Skrypt sprawdza dokument aplikacji, zgodność `weekId`, pełnego okresu i integralności odbioru. Zmieniony dokument wymaga ponownego odbioru. Domyślny cel to `current`; `--target archive` zapisuje wyłącznie klucz danego wydania.

## Kolejny tydzień i publikacja

1. Utwórz pusty szkic: `node scripts/new-public-weekly.mjs 2026-09-24`. Nie kopiuje ofert, a pusty szkic celowo nie przechodzi walidacji publikacyjnej.
2. Uzupełnij fakty według szablonu. Przed zmianą głównego wydania przygotuj dotychczasowe jako osobny artykuł, z wymaganym odbiorem aktywnych danych.
3. Dopisz jego numer i daty do `weekly/public/index.json`, zachowując starsze wpisy. Przygotuj nowe główne wydanie z tym indeksem. Istniejących archiwalnych kluczy nie trzeba ponownie zapisywać; korektę publikuj tylko do właściwego klucza.
4. Sprawdź podgląd oraz aktualną produkcję i powiązanie `CONTENT_KV`. Po zatwierdzeniu publikacji zapisz przygotowane klucze przez Wrangler. KV nie zapewnia transakcji między nimi, dlatego najpierw publikuj artykuł, potem odsyłający do niego indeks.

```sh
npx wrangler kv bulk put /tmp/2637-archive-kv.json --namespace-id <sprawdzone-ID-CONTENT_KV> --remote
npx wrangler kv bulk put /tmp/2638-public-kv.json --namespace-id <sprawdzone-ID-CONTENT_KV> --remote
```

Zwykła zmiana treści i indeksu wymaga tylko KV. Sitemap jest generowana z indeksu, bez osobnego deployu dla każdego tygodnia. Zmiana układu, kontraktu lub routingu wymaga testów i deployu aplikacji.

Po publikacji sprawdź oba artykuły, canonical, sitemap, 301 wariantów, 404 nieopublikowanego wydania i 401 chronionego API. Osobno porównaj wspólne fakty aplikacji. Brak/błąd głównej treści daje 503 bez podstawiania poprzednich bonusów; nieopublikowany osobny artykuł daje 404. Automat pozostaje odrębnym procesem — ta instrukcja nie zmienia jego harmonogramu.

## Źródła pierwszych wydań

15.09 odczytano oficjalny harmonogram Business Rivalries i miesięczny artykuł GTA+ Rockstar przez istniejący odczyt Newswire. Rotacje 2637 sprawdzono w RockstarINTEL. W 2638 pozostaje 19 potwierdzonych pozycji oraz 10 oczekujących; w 2637 zapisano 35 pozycji. Rabat członkowski Pipe Wrench pozostaje niepotwierdzony z powodu błędu źródła.

Wyzwanie 2637 wymaga sprzedaży MC Business lub Acid Lab; GTA+ daje 2X GTA$ za pierwszy finał Cluckin’ Bell tygodnia i 2X produkcji Cocaine Lockup. Poprawiono wspólne dane aplikacji, zachowując identyfikatory. 6X Bike Service wygasa 16.09; miesięczne 3X GTA$/RP ma koniec 07.10. Nie przenoś wcześniejszego zwiększenia na 2638. Przed sprzedażą wydzielenie płatnej zawartości z publicznego repo pozostaje osobnym zadaniem.

## Wynik pierwszej publikacji — 16.09.2026

**Wykonane i zweryfikowane:** główna zapowiedź 2638 oraz osobny artykuł 2637 działają na `gtacompanion.net`. Deploy Pages `c2f603e4-c5da-43f6-aefd-026f14ff31b3`, sukces 08:50:44 UTC, zakres aplikacji `733a5f9`. Publiczny schemat i indeks pochodzą z `ca17a2c`; treść 2637 z korekty `bee61d3`. Klucze `weekly:public` i `weekly:public:2637` odczytano po zapisie, zgodność dokumentów potwierdzona. Istniejący tydzień aplikacji 10–16.09 ma również odebrane korekty wspólnych faktów; 2638 pozostaje zapowiedzią.

Odbiór: 80 testów treści, 120 testów paczki aplikacji, eksport 13/13 zasobów, lokalne i produkcyjne HTTP 54/54, Chrome komputer/390 px, linki oraz CTA bez wysyłki formularza. Nie jest to dowód indeksacji Google ani test fizycznego telefonu. Harmonogramów automatyzacji w tym zadaniu nie zmieniano. Kolejny krok: aktualizacja źródeł 16.09 wieczorem i ręczne potwierdzenie po aktualizacji 17.09.
