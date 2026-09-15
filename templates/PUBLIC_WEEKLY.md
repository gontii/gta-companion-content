# Szablon pracy nad kolejnym Weekly Update

Ten plik jest instrukcją redakcyjną. Dane strony zapisujemy w JSON, wygląd poprawiamy w aplikacji. Wszystkie opisy publiczne piszemy po angielsku.

## 1. Nowy pusty szkic

W repo treści:

```sh
node scripts/new-public-weekly.mjs 2026-09-24
```

Powstanie `weekly/public/2639.json`: daty i numer ISO są wyliczone, sekcje puste, oferty oczekujące. Skrypt odmawia nadpisania istniejącego pliku. Nie kopiuje bonusów poprzedniego tygodnia. Pusty szkic celowo nie przechodzi walidacji publikacyjnej.

## 2. Źródła i fakty

- Odczytaj Newswire tygodnia, harmonogram wydarzeń, osobną ofertę GTA+ oraz brakujące rotacje. Fakty z serwisów społecznościowych przypisz do właściwego źródła; przy rozbieżności zostaw pozycję oczekującą.
- Uzupełnij `sources`: stabilne `id`, angielski `title`, pełny adres HTTPS i rzeczywisty czas odczytu `verifiedAt` w UTC, np. `2026-09-24T10:30:00.000Z`. Nie przepisuj czasu z przykładu.
- Każdy fakt: nazwa, oferta, wymagania, własne daty, źródła. Osobny późniejszy odbiór nagrody zapisuj w `claim`.
- `gtaPlus: true` wyłącznie dla korzyści wymagających GTA+ w sekcji `gta-plus`. Zwykłe rabaty oraz dodatkowe rabaty członkowskie rozdziel.
- Dla nieogłoszonej rotacji zostaw `status: pending`, pola oferty/warunków/dat/odbioru jako `null`, a `sourceIds: []`.
- Minimum jeden fakt musi być potwierdzony; zapisz rzeczywisty czas weryfikacji całego dokumentu. Zachowaj identyfikatory przy korektach.

Przykład struktury pozycji, z miejscami do zastąpienia po sprawdzeniu źródła:

```json
{
  "id": "stabilny-identyfikator",
  "name": "Activity name",
  "status": "confirmed",
  "offer": "Verified reward or discount.",
  "requirements": "Verified conditions and eligibility.",
  "startsOn": "YYYY-MM-DD",
  "endsOn": "YYYY-MM-DD",
  "claim": null,
  "gtaPlus": false,
  "sourceIds": ["source-id"]
}
```

## 3. Zapowiedź → wydanie aktywne

Zapowiedź ma `status: preview` i `confirmedAt: null`. Sam czwartek nie zmienia tego stanu. Po aktualizacji gry sprawdź źródła, uzupełnij rotacje, ustaw `active`, rzeczywiste `confirmedAt` i `verifiedAt` oraz porównaj pełny dokument z wydaniem aplikacji. Kwoty, mnożniki, wymagania, platformy i terminy muszą być zgodne. Nie przyjmuj, że wszystkie sprzedaże liczą się do wyzwania, jeśli źródło wymienia konkretne biznesy.

Przygotowanie odbioru i komendy KV: [instrukcja techniczna](../docs/PUBLIC_WEEKLY.md). Rekomendacje, checklisty i postęp pozostają w aplikacji.

## 4. Sprawdzenie i publikacja

1. `npm test` i przygotowanie artefaktu przez `scripts/prepare-public-weekly.mjs`.
2. Podgląd: komputer, telefon, daty, tabele, źródła, jeden odnośnik do bety. Instrukcja podglądu jest w aplikacji w `docs/PUBLIC_WEEKLY.md`.
3. Odbiór faktów. Przy aktywnym wydaniu obowiązuje odbiór pary dokumentów strony/aplikacji związany ich SHA-256.
4. Po zatwierdzeniu publikacji zapisz tylko `weekly:public` w sprawdzonym `CONTENT_KV`. Kod strony wdrażaj tylko, gdy uległ zmianie. Zmiana JSON nie wymaga deployu Pages.
5. Sprawdź produkcję: właściwy numer/datę/stan, 200 strony, 301 wariantów, 401 chronionego API, poprawność wspólnych faktów. Zapisz wynik w panelu projektu.

Jedna strona może zawierać bieżący tydzień i zapowiedź bezpośrednio następnego. Po zakończeniu starsze wydanie znika z widoku; historia pozostaje w Git. Gdy nie ma nowszego wydania, strona wyraźnie informuje o zakończeniu ostatniego.

## 5. Gdzie poprawiać szablon

| Zmiana | Plik |
|---|---|
| Fakty/korekta konkretnego wydania | `weekly/public/YYWW.json` |
| Ta instrukcja | `templates/PUBLIC_WEEKLY.md` |
| Pusty szkielet nowych wydań | `scripts/new-public-weekly.mjs` |
| Wymagane pola i walidacja | `schemas/public-weekly.mjs` oraz przypięta kopia w aplikacji |
| Układ, angielskie komunikaty i metadane | aplikacja: `functions/_shared/public-weekly.js` |
| Kolory, odstępy, tabele | aplikacja: `public/guide.css` |

Korekta nie zmienia numeru wydania. Nowy tydzień ma nowy plik. Nie dodawaj archiwalnych publicznych adresów ani harmonogramu automatycznej publikacji w tym procesie.
