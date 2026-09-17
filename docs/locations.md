# Wskazówki Locations

`rebuildWeeklyLocations` odbudowuje wskazówki przed zapisem zbioru głównego przez koordynatora. Dopasowuje wyłącznie aktywne oferty i przenosi ich terminy. Wygasłe lub usunięte oferty nie pozostawiają automatycznych wskazówek. Osobne notatki redakcyjne są zachowywane; powiązanie przez `itemIds` zapobiega duplikatom.

Katalog obejmuje Bunker Research, Ammu-Nation Contract, Grapeseed Bunker, Prize Ride, podium kasyna, Gun Van, Business Battles, La Coureuse i Astron Custom. Wskazówki zawierają wejście do aktywności, wymagania i sposób odbioru. Treść oferty pochodzi z bieżącego wydania. Nieznane aktywności wymagają rozbudowy katalogu; mechanizm nie zapewnia jeszcze pełnego pokrycia wszystkich przyszłych tygodni.

Gun Van ma codzienną rotację. Bez aktualnego dowodu nie podajemy konkretnego postoju jako dzisiejszego. Wskazówka wyjaśnia sposób znalezienia ikony i odsyła do aktualnego asortymentu.

## Źródła stałych instrukcji

- [Rockstar: aktualizacja 1.61 — Agent 14 i dostawy Ammu-Nation](https://support.rockstargames.com/articles/5aud9bTiQluHnVEP6x7YRp/gtav-title-update-1-61-notes-ps4-ps5-xbox-one-xbox-series-x-s-pc)
- [Rockstar: LS Car Meet](https://support.rockstargames.com/articles/7a5MsGMCeLTCp3ek6LEWrA/gtav-title-update-1-54-notes-ps4-xbox-one-pc)
- [Rockstar: Duneloader w bunkrze](https://www.rockstargames.com/newswire/article/511aoa4828o771/gunrunning-pays-dividends-in-gta-online-with-bunker-bonuses)
- [Gun Van — zmiana postoju i widoczność ikony](https://www.gamesradar.com/gta-online-gun-van/)

## Weryfikacja 17.09.2026

103 testy przechodzą, w tym odtworzenie pustej listy, wygasanie, zachowanie wpisów redakcyjnych i brak wymyślonych lokalizacji. Kandydat wydania 2638 zawiera 9 wskazówek i przechodzi rzeczywisty `parseWeeklyContent` z aplikacji. Powiązane zgłoszenie: https://github.com/gontii/gtacompanion/issues/10.
