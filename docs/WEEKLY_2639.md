# Odtworzenie archiwalnego wydania 2639

Data weryfikacji: 12.10.2026. Artykuł dotyczy 24–30.09.2026; jest zapisem historycznym, z komunikatem o zakończeniu ofert.

Treść powstała według `templates/PUBLIC_WEEKLY.md`, `docs/PUBLIC_WEEKLY.md` i `docs/WEEKLY_PUBLICATION.md`. Odczytano oficjalny harmonogram Business Rivalries oraz wrześniowy artykuł GTA+ przez GraphQL Rockstar. Porównano datowane wydania RockstarINTEL, GTABase, iGrandTheftAuto i post r/gtaonline. GTA Boss pokazuje już 08–14.10, więc nie stanowi dowodu ofert września.

67 potwierdzonych pozycji i jedna oczekująca. Gun Van: potwierdzono asortyment, lecz rabaty Battle Rifle i Tactical SMG są sprzeczne; nie rozstrzygnięto ich większością głosów. Miesięczne GTA+ zachowuje 10.09–07.10. Bez przeniesienia wcześniejszych 6X Bike Service. Penaud La Coureuse wymaga wyzwania ukończonego 03–23.09 i odbioru 24–30.09. Nightclub Management daje 2X Popularity, a nie ogólny mnożnik pieniędzy.

Odbiór porównał wspólne fakty z historycznym, częściowym `weekly/2026-09-24.json`; dodatkowe fakty strony zweryfikowano redakcyjnie. Nie zmieniono historycznego dokumentu aplikacji. SHA-256 dokładnych bajtów `weekly/public/2639.json`: `dc027044e3c3c0a00659a19dc05d79f7d8f73b782ab4f15e15be6c9c46eab059`. Dokument aplikacji i pełna lista przejrzanych ID zostały związane odbiorem przed przygotowaniem artefaktu archiwum.

Publikacja: najpierw osobny `weekly:public:2639`, po zgodnym odczycie indeks w `weekly:public`. Bieżący dokument 2641 i jego rewizja zachowane. Nie zmieniono chronionych kluczy aplikacji, kodu Pages, Workera ani harmonogramów; nie wykonywano IndexNow. `weekly/public/index.json` odzwierciedla indeks po uzupełnieniu.

Rejestr problemu i odbioru: https://github.com/gontii/gtacompanion/issues/52.

Odbiór produkcyjny 12.10: 152/152 testy treści, walidacja JSON i identyczny odczyt zapisanego klucza. HTTP: artykuł/główna/sitemap 200; wariant ze slash 301; nieopublikowane 2699 404; chronione `/api/weekly` 401. Canonical 2639 i wpis sitemap poprawne. `/api/content-status`: current=true, alarm=false, zgodna rewizja 2641 `88aee83fb4655fe6013905685bc283e7b2a26168d1c97a125f96af54c0ab268a`. Chrome: artykuł odebrany, w widoku 390×844 odnośnik 2639 widoczny między 2640 a 2638 i otwiera właściwy artykuł. Nie jest to odbiór fizycznego telefonu ani dowód indeksacji wyszukiwarki.
