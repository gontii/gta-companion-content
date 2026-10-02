# Pozostałe kryteria #10 — przygotowane do wdrożenia

Stan: przygotowane i zweryfikowane lokalnie. Bez produkcyjnego deployu tego zakresu.
Rejestr: https://github.com/gontii/gtacompanion/issues/10

## Zakres

- Deterministyczne rozpoznanie podium z nagłówka Lucky Wheel/Podium Vehicle, dokładnego pojazdu i okresu. RockstarINTEL + IGrandTheftAuto potwierdzają Lampadati Cinquemila. Opis wskazuje szansę wygranej, nie gwarantowaną nagrodę. Nie zmieniono zasad kworum ani priorytetu źródeł oficjalnych.
- Dokładny odczyt par zwykłych rabatów/GTA+ w liście Gun Van. Informacja z jednego źródła pozostaje kandydatem; sprzeczne ceny i nieustalona platforma El Strickler pozostają odrzucone. Sam asortyment nie dowodzi zniżki.
- Scalanie nie zastępuje znanej aktywnej ceny/rabatu ani FREE uboższym In stock. Okres kończy tę ochronę; test obejmuje następny tydzień.
- Diagnostyka 11 wymaganych obszarów, w tym osobno podium, Prize Ride, asortyment, zwykłe rabaty i GTA+. Stany techniczne: confirmed (potwierdzona oferta), absent (potwierdzony brak oferty), missing (brak danych), unconfirmed (niepotwierdzone źródło/konflikt). Brak sekcji w artykule nie oznacza braku oferty. Jawna deklaracja braku wymaga bieżącego okresu oraz oficjalnego źródła albo zgodności źródła podstawowego z innym.
- Incydent section-completeness po 15 minutach od czwartkowego resetu o 11:00 Europe/Warsaw. Istniejący przekaźnik incydentów może utworzyć zgłoszenie, gdy braki utrzymają się. Niezależny od incydentu aktualności.
- Metadane w weekly:receipt i /api/content-status: sectionCoverage, completenessAlarm. Nie zmieniono schematu /api/weekly ani /api/weekly-public, harmonogramu, limitów AI, wiązań ani migracji Durable Object.

Pomiar 11 obszarów sprawdza obecność wymaganych rodzajów ofert; nie dowodzi kompletności każdego rabatu, warunku platformy lub dziennego położenia. completeness=partial pozostaje jawne. Dane niepotwierdzone nie są dopisywane.

## Weryfikacja artefaktów

Worker: baza kodu produkcyjnego dc852e9, osobny katalog content-final-candidate. Bez późniejszych prac nad klasyfikacją postępu. 134/134 testy, wrangler deploy --dry-run poprawny, pełna kompilacja.

Pages: baza produkcyjnego 64eeaec5 (7c15556) zachowująca katalog Functions, konfigurację i wygląd GC. Dodano tylko diagnostykę i jej test. 288/288 testów Functions i 13/13 komponentów, typy i treści poprawne, pełna kompilacja Functions. Wszystkie 34 pliki eksportu web identyczne z bazą; wcześniejsze eksporty mobilne nie zostały zmienione.

Próbna paczka z rzeczywistych źródeł i kopii danych produkcyjnych: 60 → 61 ofert, 8 → 9 kart Locations. Wszystkie 60 ID i opisy zachowane; tylko podium dodane. Parser wdrożonego klienta przyjmuje dokument. Oba kanały i artykuł zgodne; 11/11 obszarów potwierdzonych; HTTP 401 bez sesji. Przypadki braków, deklaracji braku, konfliktu, nieaktualnego potwierdzenia, przyszłych i wygasłych ofert oraz alarmu sprawdzono wyłącznie na lokalnych danych.

## Bramka produkcyjna

Przed deployem potrzebna osobna jawna akceptacja gotowych artefaktów. Kolejność: Pages, następnie Worker. Nowy Worker działa w trybie publikacji, więc naturalny przebieg może zmienić oba kanały; nie wymuszać przebiegu ani nie zapisywać ręcznie KV. Po publikacji porównać dokumenty i odczyt aplikacji; następny naturalny przebieg ma zachować wynik. Cofnięcie do Pages 64eeaec5 i Workera 5d8e213c, bez ręcznego cofania KV. #10 pozostaje otwarte do odbioru produkcyjnego.
