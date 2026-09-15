# Publiczny Weekly Update

Stan: przygotowane; publikacja jest oddzielnym krokiem.

## Źródło i granica treści

Kanoniczny dokument: weekly/public/YYWW.json. YYWW pochodzi z roku i tygodnia ISO daty startsOn; weekId pozostaje datą. Wydanie 2638 obejmuje 17–23.09.2026. Korekta zmienia verifiedAt, a nie numer wydania.

Publiczne są wszystkie potwierdzone fakty, warunki, daty i źródła. Rekomendowana kolejność, checklisty i postęp pozostają w aplikacji. Nie kopiować aplikacyjnego weekly/latest.json do dokumentu publicznego. Archiwum redakcyjne zostaje w Git, strona ma jeden stały adres. Nie włączać automatyzacji w ramach tego procesu.

schemas/public-weekly.mjs jest kontraktem odczytu i walidacji. Aplikacja używa jego przypiętej kopii z kontrolą SHA-256. Zmiana kontraktu wymaga aktualizacji kopii i pliku blokady w aplikacji.

## Walidacja i przygotowanie KV

    npm test
    node scripts/prepare-public-weekly.mjs weekly/public/2638.json
    node scripts/prepare-public-weekly.mjs weekly/public/2638.json --output /tmp/2638-public-kv.json

Ostatnia komenda tworzy nowy plik zbiorczego zapisu dla jednego klucza weekly:public. Nie wysyła niczego do Cloudflare i odmawia nadpisania istniejącego pliku wyjściowego. Dokument aplikacji i klucz weekly:latest pozostają odrębne.

## Finalizacja aktywnego wydania

1. Po aktualizacji gry zweryfikować fakty i rotacje w źródłach. Każda nieogłoszona pozycja pozostaje pending, bez pól udających ofertę.
2. Zaktualizować publiczny dokument oraz przyszłe wydanie aplikacji. Nie zamieniać bieżącej aplikacji na zapowiedź przed czasem.
3. Obejrzeć oba pełne dokumenty razem. Sprawdzić kwoty, mnożniki, warunki, platformy, nagrody, czas trwania, okna odbioru i GTA+. Odbiór znaczenia jest redakcyjny; skróty plików same nie dowodzą zgodności faktów.
4. Publiczny dokument dostaje status active, confirmedAt po rozpoczęciu okresu oraz verifiedAt nie wcześniejszy niż potwierdzenie.
5. Po odbiorze zapisać poza publicznym HTML plik kontroli, np. w katalogu tymczasowym:
   - status: zatwierdzone
   - publicSha256: SHA-256 dokładnych bajtów dokumentu publicznego
   - appSha256: SHA-256 dokładnych bajtów dokumentu aplikacji
   - reviewedAt: rzeczywisty czas odbioru w ISO UTC
   - checkedFactIds: identyfikatory wszystkich potwierdzonych pozycji publicznych, które porównano z aplikacją.

    node scripts/prepare-public-weekly.mjs weekly/public/2638.json --app weekly/2026-09-17.json --review /tmp/2638-odbior.json --output /tmp/2638-public-kv-final.json

Skrypt waliduje dokument aplikacji, zgodność weekId, kompletność odbioru i integralność obu plików. Każda zmiana pliku po odbiorze wymaga nowego odbioru. Nie nadpisuje aplikacji.

## Publikacja po odbiorze i zgodzie

Przed publikacją sprawdzić bieżącą produkcję Pages, powiązanie CONTENT_KV i równoległe zmiany. Zatwierdzić paczkę aplikacji zawierającą nową trasę oraz właściwy dokument publiczny. Wydanie aplikacji zatwierdzać razem, publikując je jego istniejącym procesem. KV nie oferuje transakcji między tymi kluczami; po obu zapisach sprawdzić wspólne fakty strony i chronionego API.

Dopiero po zgodzie na konkretną publikację:

    npx wrangler kv bulk put /tmp/2638-public-kv-final.json --namespace-id <sprawdzone-ID-CONTENT_KV> --remote

Dla zatwierdzonej zapowiedzi użyć artefaktu zapowiedzi zamiast wersji finalnej. Brak lub błąd weekly:public skutkuje czytelnym HTTP 503, bez podstawiania poprzednich bonusów. Nie tworzyć publicznego API ani archiwalnych tras. Przed uruchomieniem sprzedaży wydzielenie płatnej zawartości z tego publicznego repo wymaga osobnego zadania.

## Weryfikacja źródeł 2638 — 15.09.2026

Odczytano oficjalne artykuły Rockstar przez istniejący odczyt Newswire GraphQL. Nagłówek oferty na stronie GTA+ potwierdza koniec 07.10.2026. Zapisano 19 potwierdzonych pozycji i 10 oczekujących pól.

- Gunrunning 17–23.09: darmowy Grapeseed Bunker, wyzwanie trzech misji, 2X Research/GTA$/RP, Ammu-Nation i Safeguard, Dolla Dolla, Astron Custom -70%.
- Community Mission Series: 3X do 23.09, bez kopiowania poprzedniej misji.
- La Coureuse: kwalifikacja do 23.09, odbiór 24–30.09; HSW wyraźnie dla Enhanced.
- GTA+: 3X GTA$/RP Bike Service do 07.10. Nie przenosić 6X z 10–16.09. Cluckin’ Bell: 2X GTA$ wyłącznie pierwszy finał tygodnia; Cocaine Lockup 2X produkcji, bez domniemania bonusu Nightclub.

Data verifiedAt odzwierciedla ten odczyt, nie czas generowania HTML. Bieżący weekly/latest.json nadal dotyczy 10.09; pełna zgodność przyszłego aktywnego wydania z aplikacją pozostaje bramką finalizacji 17.09.

## Bieżący tydzień oraz zapowiedź pod jednym adresem

Szablon krok po kroku: [templates/PUBLIC_WEEKLY.md](../templates/PUBLIC_WEEKLY.md). Pusty szkic tworzy `node scripts/new-public-weekly.mjs YYYY-MM-DD`; nie przenosi ofert i wymaga prawdziwych źródeł oraz czasu weryfikacji.

Od 15.09 strona może otrzymać jeden dokument lub obiekt `{schemaVersion: 1, editions: [bieżąceWydanie, zapowiedź]}`. Maksymalnie dwa wydania muszą następować bezpośrednio po sobie; drugie ma stan `preview`. Walidowane są oba. Po wygaśnięciu pierwsze znika z widoku, a kolejne zachowuje stan redakcyjny. Gdy oba wygasną, widoczne jest ostatnie z komunikatem o zakończeniu. Nie powstaje publiczne archiwum.

Przykład przygotowania pary, po odbiorze aktywnego 2637 z aplikacją:

```sh
node scripts/prepare-public-weekly.mjs weekly/public/2637.json \
  --app weekly/2026-09-10.json --review /tmp/2637-odbior.json \
  --next weekly/public/2638.json --output /tmp/2637-2638-public-kv.json
```

Gdy 2638 zostanie potwierdzone, przygotuj je jako pierwsze/jedyne wydanie; 2637 pozostaje tylko w Git. Nie zmieniaj numeru przy korekcie.

W 2637 zweryfikowano bieżące rotacje w RockstarINTEL oraz fakty w oficjalnych artykułach Rockstar. Błąd źródła w rabacie członkowskim Pipe Wrench pozostaje jawnie niepotwierdzony. Oficjalny warunek wyzwania to sprzedaż MC Business lub Acid Lab; poprawiono ten warunek oraz GTA+ także w `weekly/2026-09-10.json` i `weekly/latest.json`, zachowując identyfikatory. Pierwszy finał Cluckin’ Bell tygodnia ma 2X GTA$, Cocaine Lockup ma 2X produkcji; źródło nie ogłasza dodatkowego mnożnika RP finału ani produkcji Nightclub. Obie wersje są odbierane przed zapisem KV.
