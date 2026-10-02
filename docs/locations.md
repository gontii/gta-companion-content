# Wskazówki Locations

`rebuildWeeklyLocations` odbudowuje wskazówki przed zapisem zbioru głównego przez koordynatora. Dopasowuje wyłącznie aktywne oferty i przenosi ich terminy. Wygasłe lub usunięte oferty nie pozostawiają automatycznych wskazówek. Osobne notatki redakcyjne są zachowywane; powiązanie przez `itemIds` zapobiega duplikatom.

Katalog obejmuje Bunker Research, Ammu-Nation Contract, Grapeseed Bunker, Prize Ride, podium kasyna, Gun Van, Business Battles, La Coureuse i Astron Custom. Wskazówki zawierają wejście do aktywności, wymagania i sposób odbioru. Treść oferty pochodzi z bieżącego wydania. Nieznane aktywności wymagają rozbudowy katalogu; mechanizm nie zapewnia jeszcze pełnego pokrycia wszystkich przyszłych tygodni.

02.10.2026 dodano pięć wejść: Halloween Survivals, Ghosts Exposed,
Dispatch Work, Bail Office i Community Series. Nowe wskazówki zawierają
źródła Rockstar, nie kopiują dawnych nagród ani współrzędnych duchów.
Własny Bail Office jest warunkiem jego bounty, a Dispatch Work jest odrębne.
Przy Dispatch Work uwzględniono odblokowanie przez Slush Fund jako lider.

`node scripts/weekly-location-coverage.mjs weekly/2026-10-01.json 2026-10-02T12:00:00Z`
raportuje stan zapisany oraz przygotowane odtworzenie bez zapisu lub publikacji.
Rozpoznanych jest 7 rodzajów wejść, odtworzenie tworzy 7 kart zamiast 2.
Raport pokazuje osobno wszystkie 52 aktywne ID, 13 rozpoznanych pozycji,
bezpośrednie powiązania `itemIds`, brakujące rodzaje wejść i nieznane ID.
Jedna karta Gun Van grupuje wiele ofert; jedna karta Bail Office wybiera
wyzwanie przed premią. To nie oznacza 52 zweryfikowanych lokalizacji.

Kod przygotowany lokalnie; nie zmieniono zapisanych wydań, rewizji ani KV.
Nowy katalog zacznie działać w koordynatorze dopiero po osobnym deployu.

Gun Van ma codzienną rotację. Bez aktualnego dowodu nie podajemy konkretnego postoju jako dzisiejszego. Wskazówka wyjaśnia sposób znalezienia ikony i odsyła do aktualnego asortymentu.

## Źródła stałych instrukcji

- [Rockstar: aktualizacja 1.61 — Agent 14 i dostawy Ammu-Nation](https://support.rockstargames.com/articles/5aud9bTiQluHnVEP6x7YRp/gtav-title-update-1-61-notes-ps4-ps5-xbox-one-xbox-series-x-s-pc)
- [Rockstar: LS Car Meet](https://support.rockstargames.com/articles/7a5MsGMCeLTCp3ek6LEWrA/gtav-title-update-1-54-notes-ps4-xbox-one-pc)
- [Rockstar: Duneloader w bunkrze](https://www.rockstargames.com/newswire/article/511aoa4828o771/gunrunning-pays-dividends-in-gta-online-with-bunker-bonuses)
- [Gun Van — zmiana postoju i widoczność ikony](https://www.gamesradar.com/gta-online-gun-van/)
- [Rockstar: Ludendorff Cemetery Survival i Ghosts Exposed — wejście, tekst, aparat i postęp](https://www.rockstargames.com/newswire/article/3999181oaa34ko/fight-off-the-north-yankton-nightmare-in-the-new-ludendorff-cemetery-s)
- [Rockstar: Dispatch Work — Slush Fund oraz R3/RS/B](https://www.rockstargames.com/newswire/article/o3948k534952a8/protect-los-santos-and-acquire-new-law-enforcement-vehicles-during-the)
- [Rockstar: Bottom Dollar Bounties](https://www.rockstargames.com/newswire/article/51195a98k31273/gta-online-bottom-dollar-bounties-out-now)
- [Rockstar: Community Series — Legion Square, mapa i Quick Join](https://www.rockstargames.com/newswire/article/39985174okk573/bag-3x-gta-and-rp-on-drift-and-drag-races-ahead-of-next-week-s-big-gta)

Źródła odczytane 02.10.2026. Starsze artykuły są podstawą wejścia do
aktywności, a nie potwierdzeniem dawnego bonusu w obecnym tygodniu.
Aktualne mnożniki i wymagania pochodzą wyłącznie z aktywnego wydania.

## Weryfikacja 17.09.2026

103 testy przechodzą, w tym odtworzenie pustej listy, wygasanie, zachowanie wpisów redakcyjnych i brak wymyślonych lokalizacji. Kandydat wydania 2638 zawiera 9 wskazówek i przechodzi rzeczywisty `parseWeeklyContent` z aplikacji. Powiązane zgłoszenie: https://github.com/gontii/gtacompanion/issues/10.
