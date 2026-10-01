# Publikacja obu kanałów — naprawa #10

Koordynator jest jedynym autorem obu dokumentów. Publikuje potwierdzone części;
nieznane formaty, rotacje i wymagania pozostają oczekujące. Stan częściowy nie
jest dowodem kompletności. Priorytet: Rockstar, zgodne RockstarINTEL + GTABase,
TGG wyłącznie według dotychczasowej bramki. Warunki, jednostki, platforma,
członkostwo i okres są częścią porównania; nie używamy podobieństwa tekstów.

## Paczka i wznowienie

Każdy dokument ma osobny wiersz `bundle:<rewizja>:<numer>` w Durable Object.
`pending-bundle` przechowuje skróty i ostatni zakończony krok. Zapis kolejno:
`weekly:public:YYWW`, `weekly:latest`, `weekly:public` z indeksem. Przerwanie
przed zapisaniem kroku ponawia ten sam dokument. Paczka ma walidację publicznego
kontraktu, rzeczywistym parserem aplikacji (przypięta kopia z hashem źródła)
i porównanie wspólnych identyfikatorów, etykiet oraz godzin.

Odbiór po 75 s czyta niezależny `/api/content-status` i publiczne API. Jeśli
istnieje token smoke testu, dodatkowo porównuje pełne chronione API; brak tokenu
nie blokuje kontroli obu dokumentów przez serwer Pages. Endpoint statusu
czyta KV obu kanałów i artykułu, porównuje wspólne fakty, ujawnia wyłącznie
okresy, rewizje i wynik. Receipt w KV powstaje dopiero po zgodnym odczycie.

KV nie zapewnia transakcji ani natychmiastowej propagacji:
https://developers.cloudflare.com/kv/concepts/how-kv-works/
Alarms mogą się ponawiać; koordynator zachowuje własny termin kolejnej próby:
https://developers.cloudflare.com/durable-objects/api/alarms/

## Cofnięcie

Przed publikacją zachowujemy `previous-bundle-manifest`, `previous-publication`,
`previous-master`, `previous-coordinator-state`, `previous-public-page` i
`previous-fact:*`. Starsze dokumenty `bundle:*` oraz historia wydań pozostają.
Chroniony `POST /rollback` z bieżącą `revision` zatrzymuje publikację i przywraca poprzednie dokumenty oraz stan. Nie był wykonywany na produkcji. Przed cofnięciem ustaw `publication-paused` w tym samym Durable Object,
zachowaj aktualną paczkę, przywróć poprzednie dokumenty KV oraz stan, master
i wiersze faktów wskazane w `previous-fact-keys`. Dopiero po odbiorze i usunięciu przyczyny można wznowić.
Samo cofnięcie wersji Workera lub zapis poprzedniego KV nie wystarcza.

## Alarm

`gontii/gtacompanion` kontroluje `/api/content-status` co 15 minut, używając
własnego `GITHUB_TOKEN`. Jedno oznaczone zgłoszenie obejmuje bieżący incydent;
zgodny wynik zamyka wyłącznie to zgłoszenie, nigdy #10. Opóźnione wykonanie
GitHub Actions może opóźnić samą dostawę alarmu. Przekaźnik repo treści zachowuje
historię obu dokumentów i odnośnik do głównego rejestru. Status wykonania
przebiegu, publikacji i odbioru są osobne. Nowy `generatedAt`, HTTP 200 ani
ważne GTA+ nie dowodzą aktualnego wydania tygodniowego.

## Wydanie 2640

Źródła odczytane 01.10.2026: oficjalny artykuł Halloween oraz odpowiadające mu
RockstarINTEL i GTABase. `events/reviewed-weekly-2640.json` zawiera 42 przejrzane
fakty, których korekty trafiają również do koordynatora i jego wierszy faktów.
Wyzwanie: GTA$100,000 według Rockstar; kwota GTA$1,000,000 w RockstarINTEL jest
sprzeczna. Podium i Prize Ride pozostają oczekujące: GTABase nie potwierdza
sposobu zdobycia. Gun Van: potwierdzone główne oferty; dzienny postój nieustalony.
GTA+ wygasa niezależnie od tygodniowego resetu. Nie zapisujemy artykułów ani
transkrypcji w publicznym repo; odpowiedzi AI pozostają w prywatnym DO.
