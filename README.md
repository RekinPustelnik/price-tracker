# 💰 Price Tracker

Automatyczny tracker cen produktów ze sklepów internetowych. Działa w chmurze (GitHub Actions), zapisuje ceny do Google Sheets, wysyła alerty na Discord.

## Jak to działa

1. **GitHub Actions** uruchamia skrypt co 30 minut (darmowe)
2. Skrypt czyta listę produktów z **Google Sheets**
3. Wchodzi na stronę każdego produktu i wyciąga cenę **CSS selektorem**
4. Jeśli cena spadła → aktualizuje arkusz + wysyła alert na **Discord**

---

## 🚀 Konfiguracja (jednorazowa, ~10 minut)

### 1. Google Cloud — Service Account

1. Wejdź na [console.cloud.google.com](https://console.cloud.google.com/)
2. Stwórz nowy projekt (lub użyj istniejącego)
3. Wejdź w **APIs & Services → Library**
4. Wyszukaj **Google Sheets API** i kliknij **Enable**
5. Wejdź w **IAM & Admin → Service Accounts**
6. Kliknij **Create Service Account**
   - Nazwa: np. `price-tracker`
   - Kliknij **Done**
7. Kliknij na stworzone konto → zakładka **Keys**
8. **Add Key → Create new key → JSON** → pobierz plik

Z pobranego pliku JSON potrzebujesz:
- `client_email` — np. `price-tracker@my-project.iam.gserviceaccount.com`
- `private_key` — długi klucz zaczynający się od `-----BEGIN PRIVATE KEY-----`

### 2. Google Sheets — Arkusz

1. Stwórz nowy arkusz Google Sheets
2. W pierwszym wierszu (nagłówki) wpisz:

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| Nazwa | URL | Selektor | Cena | Najniższa | Alert poniżej | Ostatnie sprawdzenie |

3. Dodaj produkty od wiersza 2 — wypełnij kolumny **Nazwa**, **URL**, **Selektor** i opcjonalnie **Alert poniżej**
4. **Udostępnij arkusz** → kliknij "Udostępnij" → wklej email `client_email` z kroku 1 → rola **Edytor**
5. Skopiuj **ID arkusza** z URL-a:
   ```
   https://docs.google.com/spreadsheets/d/TUTAJ_JEST_ID/edit
   ```

### 3. Discord — Webhook

1. Na Discordzie wejdź w ustawienia kanału → **Integracje → Webhooks**
2. Kliknij **Nowy webhook**
3. Skopiuj **URL webhooka**

### 4. GitHub — Repozytorium i sekrety

1. Stwórz nowe repo na GitHub (publiczne = nieograniczone minuty darmowe)
2. Wrzuć pliki tego projektu do repo
3. Wejdź w **Settings → Secrets and variables → Actions**
4. Dodaj 4 sekrety:

| Nazwa sekretu | Wartość |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email z pliku JSON (np. `price-tracker@...iam.gserviceaccount.com`) |
| `GOOGLE_PRIVATE_KEY` | Klucz prywatny z pliku JSON (cały, łącznie z `-----BEGIN/END-----`) |
| `SPREADSHEET_ID` | ID arkusza z URL-a |
| `DISCORD_WEBHOOK_URL` | URL webhooka Discord |

5. Wejdź w zakładkę **Actions** i kliknij "I understand my workflows, go ahead and enable them"
6. Gotowe! Skrypt będzie się uruchamiał automatycznie co 30 minut.

> 💡 Możesz też uruchomić ręcznie: Actions → "Sprawdź ceny" → Run workflow

---

## 📦 Jak dodać produkt do śledzenia

1. Otwórz arkusz Google Sheets
2. W nowym wierszu wpisz:
   - **Nazwa** — dowolna, np. "Ryzen 7 7800X3D"
   - **URL** — pełny link do strony produktu
   - **Selektor** — CSS selektor elementu z ceną (patrz niżej)
   - **Alert poniżej** — opcjonalnie, cena poniżej której chcesz 🚨 alert

Kolumny **Cena**, **Najniższa**, **Ostatnie sprawdzenie** — nie ruszaj, skrypt je wypełni sam.

---

## 🔍 Jak znaleźć CSS selektor ceny

1. Wejdź na stronę produktu w przeglądarce
2. Kliknij prawym na cenę → **Zbadaj element** (Inspect)
3. Znajdź element HTML z ceną
4. Kliknij prawym na element w DevTools → **Copy → Copy selector**

### Przykłady selektorów dla popularnych sklepów

> ⚠️ Selektory mogą się zmienić gdy sklep zaktualizuje stronę. Sprawdź czy działają!

| Sklep | Przykładowy selektor | Uwagi |
|---|---|---|
| **x-kom.pl** | `.product-price` lub `[data-price]` | Sprawdź w DevTools |
| **morele.net** | `.product-price` | — |
| **mediaexpert.pl** | `.is-price` | — |
| **euro.com.pl** | `.product-price .price-normal` | — |
| **amazon.com** | `.a-price .a-offscreen` | — |
| **ceneo.pl** | `.product-offer__price .price` | — |

> 💡 **Pro tip:** Testuj selektor w konsoli przeglądarki:
> ```javascript
> document.querySelector('TWÓJ_SELEKTOR').textContent
> ```
> Jeśli zwraca cenę — selektor działa.

---

## 🛠 Uruchomienie lokalne (testowanie)

```bash
# Zainstaluj zależności
npm install

# Ustaw zmienne środowiskowe
export GOOGLE_SERVICE_ACCOUNT_EMAIL="twój-email@...iam.gserviceaccount.com"
export GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
export SPREADSHEET_ID="id-arkusza"
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."

# Uruchom
npm run check
```

Na Windows (PowerShell):
```powershell
$env:GOOGLE_SERVICE_ACCOUNT_EMAIL="twój-email@...iam.gserviceaccount.com"
$env:GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----`n...`n-----END PRIVATE KEY-----"
$env:SPREADSHEET_ID="id-arkusza"
$env:DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."

npm run check
```

---

## ❓ FAQ

**Q: Ile kosztują minuty GitHub Actions?**
A: Publiczne repo = darmowe bez limitu. Prywatne = 2000 min/mies. darmowe. Przy cronie co 30 min zużyjesz ~720 min/mies.

**Q: Cena się nie pobiera / jest null**
A: Sprawdź selektor CSS w DevTools. Niektóre strony ładują cenę JavaScriptem — wtedy prosty fetch nie zadziała (potrzebny byłby Puppeteer/Playwright, ale to inne podejście).

**Q: Mogę zmienić częstotliwość sprawdzania?**
A: Tak, edytuj `cron` w `.github/workflows/price-check.yml`. Przykłady:
- Co godzinę: `0 * * * *`
- Co 15 minut: `*/15 * * * *`
- Co 6 godzin: `0 */6 * * *`
- Raz dziennie o 9:00: `0 9 * * *`

**Q: Strona blokuje requesty**
A: Skrypt używa realistycznego User-Agent, ale niektóre strony agresywnie blokują boty. Spróbuj inny selektor lub inna stronę z tym produktem.
