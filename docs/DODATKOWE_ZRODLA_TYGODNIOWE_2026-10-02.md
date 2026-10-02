# Dodatkowe stałe źródła tygodniowe — 02.10.2026

Decyzja Przemka: dodatkowe źródła znalezione dla Prize Ride i Gun Van mają
być używane w każdym tygodniu, nie wyłącznie w korekcie wydania 2640.

## Pobieranie i uzgadnianie

Stała lista automatu obejmuje teraz IGrandTheftAuto, GTA Boss i tygodniowy
wpis r/gtaonline. iGTA odkrywa najnowszy artykuł z `/news`; GTA Boss używa
strony aktualizowanej co tydzień; Reddit wybiera wyłącznie post „Weekly Bonuses
and Discounts” z publicznego RSS, z datą publikacji i treścią samego wpisu.
Brak dostępu, nieznany format albo nieaktualny okres daje diagnostykę i brak
faktów, bez przenoszenia ofert poprzedniego tygodnia.

Kolejność: Rockstar → zgodne RockstarINTEL + GTABase → zgodny fakt
RockstarINTEL lub GTABase z dodatkowym źródłem. Dwa dodatkowe serwisy nie
potwierdzają same siebie: kopiowanie wspólnej zapowiedzi jest możliwe.
TGG zachowuje dotychczasowy warunek braku aktualnego źródła artykułowego.

Nowe serwisy odczytywane są deterministycznie dla rotacji: pełny znany wzorzec
Prize Ride oraz obecność rozpoznanych broni i pancerzy w sekcji Gun Van.
Nowych wywołań AI nie dodano; dotychczasowy wspólny limit pozostaje 8000
neuronów dziennie. Nieznane warunki, rabaty, ceny i platformy nie są zgadywane.
Sam wpis „In stock” potwierdza obecność, nie cenę, darmowe zdobycie ani rabat.
El Strickler pomijany w takim odczycie, bo sama lista nie dowodzi ograniczenia
platform. Pancerze nie przechodzą bez drugiego zgodnego wykazu.

iGTA nazywa wydanie datą czwartku, choć publikuje w środę. Gdy brakuje pełnego
zakresu, dokładny tytuł „This Week in GTA Online: …” określa siedmiodniowy
okres od wskazanego czwartku. Jest to jawna konwencja tygodniowego wydania,
nie cytat zawierający datę końcową. Inny dzień lub brak takiego tytułu nie
ustala okresu. Jawny zakres w artykule ma pierwszeństwo.

## Zgodność publikacji

Publiczny artykuł zachowuje wszystkie cytowania. Dokument aplikacyjny
zachowuje cytowanie potwierdzającego RockstarINTEL/GTABase lub Rockstar,
z identycznymi ID, ofertami i terminami. Starszy parser telefonu ma zamkniętą
listę hostów; nowe hosty nie mogą odrzucić całego tygodnia. Nie wymagano zmiany
Pages ani wydania sklepowego. Brak cytowania obsługiwanego przez starszą
aplikację zatrzymuje publikację tego dokumentu.

Walidator w wersji 10 ponownie sprawdza zachowane odpowiedzi AI bez nowej
płatnej ekstrakcji. Sprzeczne procenty i ceny tabeli GTA Boss są odrzucane
jako dowód ceny/rabatu. Nowy parser rotacji używa samych nazw, bez tych cen.

## Weryfikacja przed wdrożeniem

- `npm test`: 125/125.
- Przejście odkrywania iGTA 01.10 → 08.10, stary artykuł, zły host, błędny
  dzień, konflikt rankingu/liczby dni, pierwszeństwo Rockstar i brak dodatkowych
  rezerwacji AI: testy zaliczone.
- Zapisane publiczne odpowiedzi aktualnych trzech stron: uzgodniono Dominator
  GTT oraz 10 pozycji Gun Van jako obecność, z wyłączeniem El Strickler i bez
  cen/rabatów. W bieżącej produkcji część tych ofert już istnieje jako zatwierdzone
  korekty; nie oznacza to 11 nowych pozycji.
- Dokument próbny przyjęty przez rzeczywisty parser `src/content/types.ts`
  aplikacji; istniejące ID i opisy zachowane, cytowania publiczne pełne.
- Wrangler 4.131.2: pakowanie próbne zaliczone (191.66 KiB przed końcowym
  rozszerzeniem katalogu rozpoznawanych nazw). Wersja wdrożenia i odczyt produkcji
  zostaną dopisane po wykonaniu.

Reddit RSS w lokalnym odczycie zwrócił HTTP 403. Odczyt Workera na produkcji
powiódł się: post został pobrany z rzeczywistą datą publikacji, bez obchodzenia
blokady. Jego zakres 01–08.10 pozostaje odmienny od 01–07.10 dwóch głównych
serwisów, więc sam nie potwierdza ich dat.
Fizyczny telefon nadal wymaga bieżącego wyniku Przemka; wcześniejszej sesji
nie przenoszono na dzisiejszy odbiór.

## Wdrożenie i niezależny odczyt

Commit kodu `dc852e9` wysłany na `main`. Worker
`5d8e213c-ec6a-43fe-9f18-a666466ea7e8` wdrożony; 192.46 KiB, start 2 ms.
[Przebieg zlecenia kontroli](https://github.com/gontii/gta-companion-content/actions/runs/37015069120)
oraz [odczyt diagnostyki](https://github.com/gontii/gta-companion-content/actions/runs/37015231177)
ukończone poprawnie.

O 13:45:11 UTC automat odczytał siedem wpisów źródeł (w tym osobny okres GTA+):
iGTA 11 faktów, GTA Boss 9, Reddit 10; brak błędów źródeł. Budżet AI dnia:
0 nowych wywołań, 0 zużytych neuronów. Dodatkowe rotacje zostały uzgodnione
z RockstarINTEL; korekty bieżącego tygodnia nadal mają pierwszeństwo.

Publikacja zawiera 60 potwierdzonych pozycji, osiem kart Locations; publiczny
adapter aplikacji dodatkowo pokazuje dwa oczekujące wpisy. Rewizja
`76ec847f6ec162fcaa31b45489ce048c8881e9b20ef5756483b107e3d2abb324`
zgodna w obu kanałach i artykule. Odbiór koordynatora 13:46:26.824 UTC,
niezależny `/api/content-status` o 13:46:59.871 UTC: `current=true`,
`alarm=false`, brak przyczyn błędu, kompletność nadal częściowa.

Bezpośrednio odczytano `weekly:latest` oraz publiczne API i artykuł. Oba dokumenty
przyjął rzeczywisty parser aplikacji; 60 wspólnych ID, opisów i terminów jest
identycznych. Zachowano wszystkie 52 wcześniejsze aktywne ID. Rzeczywisty
`loadWeekly.ts` z tymi odczytami: obie ścieżki (chroniona/publiczna), pamięć
podręczna i postęp po przejściu bez sieci zaliczone w próbie programowej.
To nie jest wynik fizycznego telefonu po tej zmianie.

`npm test` w aplikacji: 329 testów funkcji i 27 komponentów, sprawdzanie typów
i treści poprawne. Nie zmieniano kodu aplikacji, jej `eas.json` ani Pages.
Pozostały niepotwierdzone pancerze, ograniczenia El Strickler i sprzeczne ceny.
Następny zaplanowany przebieg kontrolny po odbiorze: 14:01:26 UTC; jego wynik
nie jest dowodem wykonania w tej sesji.
