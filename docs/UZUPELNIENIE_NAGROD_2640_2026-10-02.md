# Dwie pominięte nagrody #10 — wdrożone i odebrane

Stan: wdrożone i odebrane produkcyjnie 06.10.2026; #10 zamknięte. Rejestr: https://github.com/gontii/gtacompanion/issues/10

Ponowny odczyt 02.10 potwierdza:

- GTA$500 000: pięć Security Contracts w okresie 1–7 października; wypłata do 72 godzin po ukończeniu. Zgodne datowane źródła RockstarINTEL i GTABase. Cel 5 w osobnym zadaniu; gwarantowana tygodniowa nagroda zwiększa liczbę zadań głównych do 4. Nie zmienia celu 2 ani nagrody GTA$100 000 dla Bail Office.
- GTA$2 000 000: ukończenie wszystkich pięciu tygodniowych wyzwań sezonu 1 października–4 listopada; wypłata do 72 godzin po ukończeniu. Pierwotny Newswire Rockstar wylicza wszystkie pięć odrębnych tygodni. Oferta sezonowa pozostaje informacyjna i nie dodaje zadania do tygodniowego licznika ani nie skraca się przy resecie 8 października. Koniec kwalifikacji: reset 5 listopada, 11:00 Europe/Warsaw; uwzględniona zmiana czasu na CET.

Źródła: [Rockstar](https://www.rockstargames.com/newswire/article/39a22k25434a53/experience-halloween-thrills-all-throughout-october-in-gta-online), [RockstarINTEL](https://rockstarintel.com/gta-online-event-week-halloween-event-returns-october-1st-7th/), [GTABase](https://www.gtabase.com/articles/grand-theft-auto-v/news/gta-online-weekly-update-october-1-7-halloween-in-los-santos-bonuses-discounts).

Uzupełnienie korzysta z istniejącego mechanizmu zatwierdzonych faktów; zachowuje oficjalne pierwszeństwo, istniejące ID, źródła, stan Durable Object, harmonogram i budżety. Bez ręcznego zapisu KV ani wymuszenia przebiegu. Po wdrożeniu zmiana może zostać opublikowana w naturalnym alarmie. Nie włączono niepotwierdzonych rabatów Gun Van.

Lokalna próbna paczka na produkcyjnej bazie 61 ofert / 9 kart: **63 oferty / 9 kart**, liczniki **4 główne / 2 dodatkowe / 3 GTA+**. Dotychczasowe 61 ID, opisy i grupy postępu zachowane. Parser przyjmuje dokument; test obejmuje cel 5, opóźnienie wypłaty, następny przebieg, granicę tygodnia, zachowanie sezonowej oferty, dokładne wygaśnięcie i obu kanałów. 140/140 testów oraz Worker dry-run poprawne.

Wymagana osobna akceptacja tego gotowego uzupełnienia przed deployem. To dodatkowe dane poza odebranym wcześniej podium i diagnostyką. Nie zamykać #10 na podstawie samej próbnej paczki.


## Odbiór produkcyjny 06.10.2026

Po akceptacji gotowego uzupełnienia wdrożono wyłącznie Worker
`75ebeae0-ee17-412a-bd76-d5f561b63752`, bez zmiany Pages, stanu DO, migracji,
KV, trybu publikacji lub harmonogramu. Ponowne 140/140 testów, dry-run i
integralność przygotowanego artefaktu poprawne.

Naturalna publikacja 20:05:02 UTC i odbiór 20:06:17 UTC: 63 oferty / 9 kart,
liczniki 4/2/3. Zwykły przebieg 20:21:17 UTC zachował rewizję
`fe36bad8e52909373b93e8acff0e0dc66139a40e1818de942caaa365ddf951e5`.
Oba kanały i artykuł zgodne. Wszystkie wcześniejsze 61 ID, opisy i grupy
postępu zachowane; Locations identyczne. Parser faktycznie wdrożonej aplikacji
przyjmuje oba kanały. Oba alarmy wyłączone, chronione API bez sesji HTTP 401.
Odbiór przeglądarki na komputerze i 390 px poprawny, postęp zachowany po
odświeżeniu, cel Security Contracts 5. Sezonowa premia poza licznikiem tygodniowym.

[Końcowy odbiór #10](https://github.com/gontii/gtacompanion/issues/10#issuecomment-6024742805).
Zgłoszenie zamknięte 06.10.2026; zakres urządzeń #4 pozostaje osobny.
Niepotwierdzone szczegóły danych nadal jawne, `completeness=partial`.
Nie wykonano ręcznego zapisu KV ani wymuszonego przebiegu.
