# Automatyczne aktualizacje treści

Stan na 15.09.2026: Worker wdrożony w trybie `observe`, zgodna aplikacja opublikowana (Pages `d76dcdb0`). Przełączenie na publikowanie wymaga zakończenia prób źródeł, Supadata i zgodnej aplikacji. Sama obecność crona nie oznacza świeżej publikacji.

## Podział odpowiedzialności

Cloudflare Worker `gta-companion-content-updater` przyjmuje żądania i nadzoruje harmonogram. Jeden SQLite Durable Object `weekly-publication` przechowuje daty, fakty, poprzednią publikację, rezerwacje limitów i kolejkę historii. Nie obsługuje ruchu użytkowników aplikacji. `CONTENT_KV/weekly:latest` obsługuje nadal chronione API Pages.

GitHub Actions `content-relay.yml` odbiera historię i synchronizuje zgłoszenia błędów. Używa krótkotrwałego `github.token` z prawami `contents:write` i `issues:write`. Worker nie otrzymuje tokenu GitHub. Opóźnienie lub awaria Actions nie zatrzymuje publikacji w KV. Przekaźnik sprawdza także sygnał nadzorcy Cloudflare; brak przez 45 minut jest osobnym zdarzeniem. Kontrola z GitHub sama może się opóźnić.

Sekret `AUTOMATION_TOKEN` w Workerze odpowiada sekretowi `CONTENT_AUTOMATION_TOKEN` w GitHub. Daje dostęp wyłącznie do statusu, zlecenia sprawdzenia, odbioru/potwierdzenia historii i przekazania testowego tokenu aplikacji. Nie przyjmuje dowolnej treści do publikacji. `SUPADATA_API_KEY` występuje wyłącznie w sekretach Workera. Niczego nie zapisujemy do `.env` ani do historii Git.

## Daty i publikacja

`temporal.mjs` jest kontraktem współdzielonym z aplikacją przez `node scripts/sync-temporal.mjs /katalog/aplikacji`. Wszystkie czasy wynikowe są UTC, reguły dnia używają `Europe/Warsaw`, z obsługą czasu letniego i zimowego. Przy dacie bez godziny start jest ostrożnie szacowany na 11:00, a koniec na północ po ostatnim dniu. Oba szacunki są oznaczone; nie stanowią potwierdzonej godziny resetu. Dokładne godziny przyjmujemy wyłącznie z udokumentowaną strefą i dowodem w źródle.

Wtorek, środa, czwartek i dni zmian: co 15 minut od 08:50 do 12:05. Oczekiwanie na dane lub oficjalną korektę: dalej co godzinę do 22:05 i od kolejnego poranka. Pozostałe dni: 10:50, 14:50, 18:50. Znane rozpoczęcie ma przygotowanie 10 minut wcześniej i osobny alarm aktywacji. Wygaśnięcie nie wymaga nowego artykułu. Każde przetwarzanie, także błędne i bez zmian, zapisuje kolejny termin i powód.

Fakty przyszłe pozostają w prywatnej kolejce do swojego terminu. Koniec weekendu, okres GTA+, etap wydarzenia i okna zdobycia/odbioru nagrody mają osobne terminy. Znane, wcześniej potwierdzone etapy wydarzenia mogą zmienić listę wyzwania bez nowego artykułu. Poprzednie przyszłe terminy nie znikają przy niepełnym odczycie źródeł.

Publikacja zachowuje `weekId` dla postępu oraz osobny skrót `revision`. Zapis przed wykonaniem operacji KV umożliwia ponowienie identycznej publikacji po awarii. Brak zmiany treści nie tworzy kolejnej rewizji. Poprzednia publikacja pozostaje w obiekcie; Git przechowuje niezmienne pliki `weekly/revisions/<revision>.json`. Kolejka historii jest potwierdzana dopiero po udanym pushu.

Po zapisie KV automat czeka co najmniej 75 sekund na propagację i porównuje pełną odpowiedź chronionego `/api/weekly` z oczekiwanym widokiem czasowym. Oddzielnie sprawdza odmowę 401 bez tokenu. Nieznany wynik i awaria zapisu nie są sukcesem. Przekaźnik odnawia testową sesję przez istniejące sekrety GitHub `BETA_SMOKE_CODE` i `SMOKE_TEST_EMAIL`; nie wypisuje kodu ani tokenu.

## Źródła i limity

1. Potwierdzone fakty Rockstar mają pierwszeństwo.
2. RockstarINTEL i GTABase muszą zgadzać się co do oferty, liczb, platform, członkostwa i dat. Rozbieżność pozostawia pozycję oczekującą.
3. Wyłącznie przy braku bieżącego artykułu w monitorowanych źródłach sprawdzamy odpowiedni film kanału TGG `UC72PuhDwKtZ5MikpGNhPAtA`. Sama dostępność napisów lub tytuł filmu nie są dowodem treści.

Model Workers AI wyodrębnia fakty i fragmenty dowodowe, a kod weryfikuje ich obecność oraz liczby, daty, platformy i GTA+. Nieznane pola nie stają się ofertami. Niepełna aktualizacja ma oznaczone sekcje oczekujące. Ręczne korekty istniejącego tygodnia zachowują identyfikatory i termin ważności. Brak nowego miesięcznego GTA+ nie zatrzymuje sekcji tygodniowych.

Supadata: wyłącznie `mode=native`, angielskie napisy ze znacznikami czasu, bez generowania audio i doładowań. Lokalny limit 95 kredytów w ruchomym oknie 32 dni zostawia margines względem darmowych 100 na cykl konta. Cykl konta zaczyna się od rejestracji (tu 15. dnia miesiąca); licznik nie zeruje się przedwcześnie pierwszego dnia miesiąca. Rezerwacja następuje przed żądaniem, także niepewna próba zużywa rezerwację. Do 4 prób w pierwszej dobie, później jedna dziennie. Zadania 202 są odpytywane osobno. Prywatna transkrypcja i wynik wyodrębnienia mają retencję 30 dni; pełna transkrypcja nie trafia do Git ani do aplikacji.

Model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`: rezerwacja 2000 neuronów przed wywołaniem, limit automatu 8000/dobę UTC. Po odpowiedzi z poprawnym pomiarem rozliczana jest konserwatywna wartość rzeczywista według stawek modelu, z marginesem. Niepewny wynik pozostawia pełną rezerwację. Odpowiedź obejmuje maksymalnie 24 najważniejsze fakty ze wszystkich sekcji; wynik jest celowo oznaczony jako częściowy. Osiągnięcie limitu blokuje kolejne wywołania bez zmiany planu usługi. Limit API 120 s, limit odczytu źródła 25 s, ograniczona wielkość odpowiedzi i lista dozwolonych hostów.

Źródła techniczne: [Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [alarmy](https://developers.cloudflare.com/durable-objects/api/alarms/), [limity KV](https://developers.cloudflare.com/kv/platform/limits/), [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Supadata](https://docs.supadata.ai/get-transcript).

## Uruchomienie i przełączenie

1. `npm ci`, `npm test`, `npx wrangler types`, `npx wrangler deploy --dry-run`.
2. Wdrożyć kompatybilną aplikację: wygaśnięcia we wszystkich widokach, odświeżanie po powrocie i co 15 minut, cache API 60 s. Wykonać kontrolę chronionego API.
3. Wdrożyć Worker z `PUBLICATION_MODE=observe`. Skonfigurować sekrety, zmienną GitHub `CONTENT_UPDATER_URL` i uruchomić `content-relay.yml` z `request_check=true`.
4. Potwierdzić odczyt właściwych artykułów i poprawność zaakceptowanych/odrzuconych faktów. Zalogować Supadata w darmowym planie, ustawić klucz bez wypisywania go i sprawdzić rzeczywistą transkrypcję z Cloudflare wraz ze znacznikiem czasu.
5. Dopiero po kontrolach ustawić zmienną GitHub `CONTENT_WRITER=cloudflare` (dotychczasowy job ma tę bramkę), sprawdzić brak trwającego starego publikowania, następnie wdrożyć `PUBLICATION_MODE=publish`.
6. Potwierdzić `publishedRevision == verifiedRevision`, odczyt aplikacji, samoistne wygaśnięcie i wykonanie kolejnego terminu. Dopiero wtedy wynik jest zweryfikowany produkcyjnie.

Ręczne sprawdzenie: `gh workflow run content-relay.yml -f request_check=true --repo gontii/gta-companion-content`. Trafia do tego samego autora publikacji; nie tworzy drugiego zapisu KV.

Zatrzymanie: wdrożyć `PUBLICATION_MODE=observe`. Nie włączać równocześnie starego autora KV. Aplikacja nadal ukrywa wygasłe dane. Ewentualne odtworzenie historycznej rewizji wymaga sprawdzenia jej dat i pozostawienia automatu w obserwacji. Dane z niepewnym terminem nie są przedłużane podczas awarii.

## Odbiór 15.09.2026

Sprawdzono 67/67 testów treści, w tym żądanie podczas odczytu źródła, zachowanie warunku nagrody oraz oddzielne okresy tej samej oferty i powrót zwykłego bonusu po weekendzie. Produkcyjna paczka aplikacji: 113/113 testów, TypeScript, eksport i 13 zasobów; po wdrożeniu 26/26 kontroli HTTP oraz HTTP 200 statystyk S1. Odrębnie bieżący kod aplikacji: 158/158 testów i eksporty JavaScript Android/iOS; nie zastępuje to testu urządzenia ani publikacji sklepowej.

Rzeczywiste odczyty Cloudflare potwierdziły właściwy tygodniowy artykuł Rockstara, RockstarINTEL i GTABase. Odczyt GTA+ jest osobny; niepełny wynik pozostaje oczekujący. Alarmy nadzorcy wystąpiły samoczynnie w odstępach 15 minut. Test wygaśnięcia w przeglądarce wykonano z danymi syntetycznymi wyłącznie lokalnie, także po zatrzymaniu serwera.

Supadata skonfigurowana 15.09 po logowaniu właściciela: klucz jest szyfrowanym sekretem Workera, panel pokazuje 100 kredytów i brak dodatkowego pakietu. Po zapisaniu klucza Workera należy uruchomić `gh workflow run content-relay.yml -f probe_tgg=true --repo gontii/gta-companion-content`. Ta próba działa wyłącznie w obserwacji, pobiera transkrypcję z Cloudflare i zapisuje wynik `tggProbe`; nie omija warunku wyboru źródła w normalnej publikacji. Weryfikacja faktów i znaczników czasu oraz pozytywny wynik pozostają obowiązkowe przed przełączeniem.

Przekaźnik GitHub: przebieg `34997722369` zakończony sukcesem. Odnowiony token dał HTTP 200 z `private, max-age=60` na chronionym API; status przechowuje `apiAccessCheck`, bez tokenu. Testy ekstrakcji wykorzystały dzienny limit automatu: `ai_free_budget_exhausted` został obsłużony bez podnoszenia limitu. Odczyt źródeł po końcowej poprawce walidatora pozostaje do potwierdzenia po odnowieniu limitu UTC. Wersja walidacji 7 archiwizuje eksperymentalny stan obserwacji i odtwarza kandydata z danych produkcyjnych oraz ponownie sprawdzonych faktów. Publikacja nie była włączana.

Dalszy odbiór Supadata 15.09: 70/70 testów po dodaniu kontroli cyklu kredytów i ponowienia próby TGG. Pobranie transkrypcji zapisuje prywatne metadane i krótką próbkę niezależnie od wyniku AI. Publiczny dziennik przekaźnika pokazuje wyłącznie metadane, bez próbki. Po wyczerpaniu dziennego limitu AI próba sama czeka do 00:02 UTC i ponawia się z istniejących napisów; wynik 202 jest kontrolowany nie częściej niż co 15 minut. Sama pobrana transkrypcja nadal nie odblokowuje publikacji bez porównania faktów.

RSS TGG może zawierać wyłącznie 15 nowszych Shorts i transmisji — zaobserwowano to 15.09. Przy braku właściwego filmu automat pobiera jedną stronę wyszukiwania Supadata, sprawdza dokładny identyfikator kanału, tytuł i datę. Jedna strona kosztuje 1 kredyt; brak automatycznej paginacji. Wynik jest pamiętany przez 6 godzin, a RSS nadal sprawdzany pierwszy. Wyszukiwanie i napisy korzystają ze wspólnego limitu 95 kredytów/32 dni. Dokumentacja: [wyszukiwanie Supadata](https://docs.supadata.ai/youtube/search). Kontrola lokalna po tej poprawce: 71/71 testów.

Wyszukiwanie używa trafności; wyniki mogą podawać datę względną, np. „5 days ago”. Automat nie zamienia jej w datę publikacji ani wydarzenia. Dla maksymalnie dwóch pasujących filmów pobiera `/v1/metadata` i sprawdza ponownie kanał, identyfikator, tytuł oraz dokładne `createdAt`. Metadane są pamiętane przez 30 dni i kosztują 1 kredyt przy pobraniu, w tym samym limicie 95. Test obejmuje odrzucenie innego kanału i starego filmu mimo świeżej daty względnej w wynikach; kontrola lokalna 72/72. Dokumentacja: [metadane Supadata](https://docs.supadata.ai/get-metadata).

Odbiór rzeczywistego pobrania: 15.09 o 18:31 UTC Worker `87485d2d` zapisał `transcriptCheck.status=downloaded` dla TGG `V08qE5jkLW4`: 128 fragmentów, 4843 znaki, znaczniki 240–279688 ms. Potwierdzenie: [przekaźnik 35008026695](https://github.com/gontii/gta-companion-content/actions/runs/35008026695). Analiza zatrzymała się na dziennym limicie AI i sama wznowi się 16.09 o 00:02 UTC (02:02 w Polsce); termin jest zapisany w obiekcie. Tryb pozostaje `observe` do porównania wyodrębnionych faktów. Konto i klucz są gotowe. CI [35008074284](https://github.com/gontii/gta-companion-content/actions/runs/35008074284) dla `47c7ba3`: 77/77 w bieżącym repozytorium, w tym pięć równoległych testów SEO; wydzielona paczka automatu 72/72.
