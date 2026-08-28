# ⚙️ Instrukcja Konfiguracji Krok po Kroku — Price Tracker

Niniejszy przewodnik przeprowadzi Cię przez proces pełnej konfiguracji wszystkich usług wymaganych do uruchomienia i automatyzacji bota **Price Tracker**.

---

## 📋 Wymagania wstępne

Przed rozpoczęciem upewnij się, że posiadasz:
- Konto **Google** (do utworzenia arkusza i konfiguracji Google Cloud).
- Konto **Discord** z uprawnieniami do zarządzania wybranym kanałem (do stworzenia Webhooka).
- Konto **GitHub** (do darmowego uruchamiania skryptu w chmurze przez GitHub Actions).
- *(Opcjonalnie)* Konto **[ScraperAPI](https://www.scraperapi.com/)** (darmowe 5000 zapytań/miesiąc do omijania blokad 403).

---

## Krok 1: Konfiguracja Google Cloud (Konto Serwisowe)

Do bezpiecznej komunikacji z Google Sheets API bez konieczności interaktywnego logowania (OAuth) wykorzystywane jest **Konto Serwisowe (Service Account)**.

1. Zaloguj się do [Google Cloud Console](https://console.cloud.google.com/).
2. W górnym menu kliknij selektor projektów i wybierz **New Project** (Nowy projekt).
   - Nazwij projekt, np. `Price-Tracker-App`, i kliknij **Create**.
3. Po utworzeniu projektu upewnij się, że jest on wybrany w górnym pasku.
4. Przejdź do **APIs & Services → Library** (Interfejsy API i usługi → Biblioteka).
5. Wyszukaj **Google Sheets API**, wybierz je i kliknij przycisk **Enable** (Włącz).
6. W lewym menu przejdź do **IAM & Admin → Service Accounts** (Administracja tożsamością i dostępem → Konta usługowe).
7. Kliknij **Create Service Account** (Utwórz konto usługi) w górnym pasku:
   - **Service account name**: np. `price-tracker-bot`
   - **Service account ID**: wygeneruje się automatycznie
   - Kliknij **Create and Continue**, a następnie **Done** (nie musisz przypisywać ról na poziomie projektu).
8. Na liście kont kliknij nowo utworzone konto (jego adres email, np. `price-tracker-bot@twoj-projekt.iam.gserviceaccount.com`).
9. Przejdź do zakładki **Keys** (Klucze).
10. Kliknij **Add Key → Create new key** (Dodaj klucz → Utwórz nowy klucz).
11. Wybierz format **JSON** i kliknij **Create**. Plik klucza zostanie pobrany na Twój dysk.

> [!IMPORTANT]
> Otwórz pobrany plik JSON w edytorze tekstu (np. Notatnik, VS Code). Będziesz potrzebować dwóch wartości:
> - `client_email`: adres email Twojego bota (np. `price-tracker-bot@...iam.gserviceaccount.com`)
> - `private_key`: ciąg klucza prywatnego zaczynający się od `-----BEGIN PRIVATE KEY-----` i kończący na `-----END PRIVATE KEY-----\n`.

---

## Krok 2: Przygotowanie Google Sheets

1. Otwórz [Google Sheets](https://sheets.google.com/) i utwórz **Nowy pusty arkusz**.
2. Nadaj mu czytelną nazwę (np. `Monitoring Cen`).
3. W pierwszym wierszu (wiersz nagłówkowy) wprowadź dokładnie poniższy układ kolumn:

| Kolumna | Nazwa nagłówka | Przeznaczenie |
|:---:|---|---|
| **A** | `Nazwa` | Dowolna nazwa produktu (np. *Procesor AMD Ryzen 7 7800X3D*) |
| **B** | `URL` | Bezpośredni link do podstrony produktu w sklepie |
| **C** | `Selektor` | CSS selektor wskazujący na element z ceną (np. `.product-price`) |
| **D** | `Cena` | Ostatnio odczytana cena *(wypełnia automat)* |
| **E** | `Najniższa` | Historycznie najniższa odnotowana cena *(wypełnia automat)* |
| **F** | `Alert poniżej` | *(Opcjonalnie)* Kwota, poniżej której chcesz otrzymać alert priorytetowy 🚨 |
| **G** | `Ostatnie sprawdzenie` | Data i godzina ostatniej udanej aktualizacji *(wypełnia automat)* |

4. **Udostępnij arkusz dla bota**:
   - Kliknij zielony przycisk **Udostępnij** (Share) w prawym górnym rogu.
   - W polu adresu wpisz `client_email` pobrany z pliku JSON konta serwisowego.
   - Ustaw rolę jako **Edytor** (Editor) i odznacz opcję wysyłania powiadomienia email.
   - Kliknij **Udostępnij**.
5. **Skopiuj ID arkusza**:
   - Spójrz na pasek adresu URL w przeglądarce:
   ```
   https://docs.google.com/spreadsheets/d/1a2B3c4D5e6F7g8H9i0J_TUTAJ_ZNAJDUJE_SIE_ID/edit#gid=0
   ```
   - Skopiuj ciąg znaków znajdujący się pomiędzy `/d/` a `/edit` — jest to Twój `SPREADSHEET_ID`.

---

## Krok 3: Konfiguracja Discord Webhook

1. Uruchom Discorda i przejdź na serwer, na którym chcesz otrzymywać powiadomienia.
2. Wejdź w **Ustawienia kanału** (ikona koła zębatego przy wybranym kanale tekstowym).
3. Przejdź do zakładki **Integracje** (Integrations) → **Webhooki** (Webhooks).
4. Kliknij **Nowy webhook** (New Webhook).
5. Nadaj webhookowi nazwę (np. `Price Tracker`) i opcjonalnie ustaw awatar.
6. Kliknij **Kopiuj adres URL webhooka** (Copy Webhook URL).

Ciąg znaków ma postać:
```
https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz...
```

---

## Krok 4: (Opcjonalnie) Konfiguracja ScraperAPI

Niektóre polskie i zagraniczne sklepy (np. Morele, Media Expert) stosują zaawansowane filtry Cloudflare blokujące standardowe zapytania serwerowe kodem `403 Forbidden`. Price Tracker posiada wbudowany automatyczny mechanizm fallbacku na bramkę proxy **ScraperAPI**.

1. Zarejestruj się bezpłatnie na [ScraperAPI.com](https://www.scraperapi.com/).
2. Na pulpicie nawigacyjnym (Dashboard) skopiuj swój **API Key**.
3. Darmowy plan oferuje **5 000 kredytów miesięcznie**, co pozwala na comiesięczne sprawdzanie wielu produktów.

---

## Krok 5: Konfiguracja GitHub Actions (Sekrety)

Aby skrypt działał automatycznie w chmurze bez konieczności uruchamiania Twojego komputera:

1. Przejdź do swojego repozytorium na GitHubie.
2. Wejdź w **Settings** (Ustawienia) → **Secrets and variables** → **Actions**.
3. Kliknij **New repository secret** i dodaj kolejno następujące sekrety:

| Nazwa Sekretu | Wartość |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Adres email z pliku JSON (`client_email`) |
| `GOOGLE_PRIVATE_KEY` | Cały klucz prywatny z pliku JSON (wraz z nagłówkami `-----BEGIN PRIVATE KEY-----` oraz `-----END PRIVATE KEY-----`) |
| `SPREADSHEET_ID` | Identyfikator arkusza wyodrębniony z adresu URL |
| `DISCORD_WEBHOOK_URL` | Pełny link do utworzonego Webhooka na Discordzie |
| `SCRAPER_API_KEY` | *(Opcjonalnie)* Twój klucz z platformy ScraperAPI |

4. Wejdź w zakładkę **Actions** w swoim repozytorium na GitHubie.
5. Jeśli wyświetli się komunikat o zablokowanych workflow, kliknij **"I understand my workflows, go ahead and enable them"**.
6. Możesz przetestować działanie od razu: kliknij po lewej **Sprawdź ceny** → **Run workflow**.

---

## Krok 6: Dostosowanie Częstotliwości (Cron)

Domyślnie skrypt uruchamiany jest **co 12 godzin** (plik [.github/workflows/price-check.yml](file:///d:/Programowanie/price-tracker/.github/workflows/price-check.yml)), aby chronić limity zapytań i darmowe pule ScraperAPI.

Możesz dowolnie zmienić harmonogram, modyfikując linijkę `cron:`:

```yaml
on:
  schedule:
    - cron: '0 */12 * * *'  # Domyślnie: co 12 godzin
```

### Przykłady konfiguracji cron:

| Częstotliwość | Zapis Cron | Uwagi |
|---|---|---|
| Co 12 godzin | `0 */12 * * *` | *(Zalecane)* Rano i wieczorem, bezpieczne dla limitów |
| Co 6 godzin | `0 */6 * * *` | 4 razy na dobę |
| Raz dziennie o 8:00 UTC | `0 8 * * *` | Stała pora każdego dnia |
| Co 1 godzinę | `0 * * * *` | Sprawdza co godzinę |
| Co 30 minut | `*/30 * * * *` | Wysoka częstotliwość |

---

## Krok 7: Uruchomienie i testowanie w środowisku lokalnym

Możesz uruchomić skrypt bezpośrednio na swoim komputerze.

1. Sklonuj repozytorium i zainstaluj pakiety:
   ```bash
   git clone <URL_REPOZYTORIUM>
   cd price-tracker
   npm install
   ```

2. Skopiuj plik `.env.example` do pliku `.env`:
   ```bash
   cp .env.example .env
   ```

3. Uzupełnij zmienne w `.env` swoimi danymi.

4. Uruchom skrypt testowy:
   ```bash
   npm run check
   ```
