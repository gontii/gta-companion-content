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

Reddit RSS w lokalnym odczycie zwraca HTTP 403. Stały adapter jest dodany,
lecz fakty z Reddita nie są uznane za pobrane. Nie omijano blokady dostępu.
Fizyczny telefon nadal wymaga bieżącego wyniku Przemka; wcześniejszej sesji
nie przenoszono na dzisiejszy odbiór.
