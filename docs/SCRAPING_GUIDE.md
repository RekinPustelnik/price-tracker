# 🔍 Przewodnik po Scrapingu i Doborze Selektorów CSS

Niniejszy dokument szczegółowo wyjaśnia, jak poprawnie dobierać selektory CSS dla sklepów internetowych, jak działa wewnętrzny parser cen oraz jak radzić sobie z typowymi problemami podczas scrapingu.

---

## 1. Jak Price Tracker pobiera dane?

Aplikacja wykorzystuje model **lekkiego scrapingu serwerowego**:
1. Wykonywane jest zapytanie HTTP `GET` z nagłówkami naśladującymi przeglądarkę (lub zapytanie przez proxy ScraperAPI).
2. Zwrócona odpowiedź HTML jest parsowana przez bibliotekę **Cheerio** (odpowiednik jQuery w Node.js).
3. Na drzewie DOM wykonywane jest zapytanie za pomocą przekazanego **selektora CSS** (`$(selector).first().text()`).
4. Odczytany tekst jest przekazywany do funkcji `parsePrice()`, która wyodrębnia kwotę jako typ numeryczny.

> [!NOTE]
> Ponieważ Price Tracker nie uruchamia pełnej przeglądarki ze środowiskiem graficznym (jak Puppeteer czy Playwright), zużywa ułamek megabajta pamięci RAM i wykonuje się błyskawicznie w ramach darmowych limitów GitHub Actions.

---

## 2. Jak znaleźć i przetestować selektor CSS?

### Krok 1: Inspekcja elementu
1. Otwórz podstronę produktu w przeglądarce (Chrome, Firefox, Edge).
2. Kliknij prawym przyciskiem myszy na cenę i wybierz **Zbadaj** / **Zbadaj element** (Inspect).
3. W drzewie DOM narzędzi deweloperskich (DevTools) podświetli się znacznik HTML zawierający cenę.

### Krok 2: Skopiowanie selektora
- **Szybka metoda**: Kliknij prawym przyciskiem myszy na zaznaczony węzeł w DevTools → **Kopiuj** (Copy) → **Kopiuj selektor** (Copy selector).
- **Lepsza metoda (Manualna)**: Zidentyfikuj unikalną klasę CSS lub atrybut danych (`data-*`), który jest odporny na drobne zmiany układu strony.

### Krok 3: Test w konsoli przeglądarki
Otwórz zakładkę **Console** w DevTools i wpisz:

```javascript
document.querySelector('TWÓJ_SELEKTOR').textContent.trim()
```

**Przykład:**
```javascript
document.querySelector('.product-price .price-normal').textContent.trim()
// Powinno zwrócić np.: "2 499,00 zł"
```

Jeśli polecenie zwraca poprawny tekst zawierający cenę, selektor nadaje się do wpisania w kolumnie **C (Selektor)** w Twoim arkuszu Google Sheets.

---

## 3. Dobre vs Złe Selektory

| Jakość | Przykładowy selektor | Dlaczego? |
|---|---|---|
| 🟢 **Doskonały** | `[data-price]` lub `[itemprop="price"]` | Opiera się na semantyce danych lub mikrodanych Schema.org; rzadko zmienia się przy redesignie sklepu. |
| 🟢 **Bardzo dobry** | `.main-price__value`, `.product-price` | Wykorzystuje dedykowane, unikalne klasy komponentu cenowego. |
| 🟡 **Przeciętny** | `div.prices > span:first-child` | Może przestać działać, jeśli sklep doda np. etykietę "Promocja" lub "Najniższa cena z 30 dni". |
| 🔴 **Zły (kruchy)** | `#app > div:nth-child(2) > div:nth-child(4) > span:nth-child(3)` | Bardzo kruchy; dowolna zmiana struktury strony natychmiast go unieważni. |

---

## 4. Jak działa algorytm `parsePrice()`?

Funkcja `parsePrice(text)` zdefiniowana w [src/scraper.js](file:///d:/Programowanie/price-tracker/src/scraper.js#L136-L162) została zoptymalizowana pod kątem różnorodnych standardów formatowania cen w polskich i międzynarodowych sklepach:

### Przykłady konwersji:

| Wejściowy ciąg tekstowy | Przetworzenie | Wynik (`number`) |
|---|---|:---:|
| `"1 234,56 zł"` | Usunięcie spacji, zamiana `,` na `.` | `1234.56` |
| `"1.234,56 PLN"` | Usunięcie separatora tysięcy `.`, zamiana `,` na `.` | `1234.56` |
| `"1,234.56"` | Usunięcie `,` jako separatora tysięcy | `1234.56` |
| `"239,99 zł."` | Usunięcie kropki końcowej | `239.99` |
| `"  49,00  "` | Przycięcie białych znaków, zamiana `,` na `.` | `49.00` |
| `"99 zł"` | Liczba całkowita | `99` |

### Logika algorytmu:
1. Usuwa wszystkie znaki poza cyframi, przecinkami i kropkami (`/[^\d.,]/g`).
2. Usuwa ewentualne kropki i przecinki znajdujące się na samym początku lub końcu ciągu.
3. Sprawdza pozycję ostatniego przecinka i ostatniej kropki:
   - Jeśli ostatni przecinek występuje **po** ostatniej kropce (standard PL/EU, np. `1.299,00`), usuwa kropki, a przecinek zamienia na kropkę dziesiętną.
   - Jeśli ostatnia kropka występuje **po** ostatnim przecinku (standard US/UK, np. `1,299.00`), usuwa przecinki.
   - Jeśli występuje tylko przecinek, a po nim są maksymalnie 2 cyfry (np. `199,99`), jest on traktowany jako separator części ułamkowej.

---

## 5. Przykładowe selektory dla popularnych sklepów

> [!WARNING]
> Poniższe selektory stanowią punkty wyjścia. Sklepy internetowe regularnie aktualizują swój kod HTML, dlatego zawsze warto zweryfikować selektor w DevTools przed dodaniem go do arkusza.

| Sklep | Przykładowy selektor CSS | Uwagi |
|---|---|---|
| **x-kom.pl** | `.product-price` lub `[data-price]` | Czasem wymaga ScraperAPI przy intensywnych zapytaniach. |
| **morele.net** | `.product-price` lub `#product_price` | Korzysta z ochrony Cloudflare; zalecany `SCRAPER_API_KEY`. |
| **mediaexpert.pl** | `.is-price` lub `.main-price .whole` | Może rozbijać złote i grosze na osobne tagi `span`. |
| **euro.com.pl** | `.product-price .price-normal` | Stabilna struktura klas. |
| **amazon.pl / .com** | `.a-price .a-offscreen` | Amazon ukrywa pełną cenę dla czytników ekranowych w `.a-offscreen`. |
| **ceneo.pl** | `.product-offer__price .price` | Dobry do śledzenia najniższej oferty z porównywarki. |
| **allegro.pl** | `[itemprop="price"]` lub `[data-box-name="Price"]` | Warto szukać mikrodanych Schema. |

---

## 6. Typowe problemy i ich rozwiązywanie

### Problem 1: Cena zwraca `null` (brak elementu w HTML)
- **Przyczyna**: Strona to aplikacja Single Page Application (SPA), która ładuje cenę asynchronicznie przez JavaScript/API dopiero po załadowaniu szkieletu HTML.
- **Rozwiązanie**:
  1. Wyłącz JavaScript w przeglądarce (DevTools → Settings → Disable JavaScript) i odśwież stronę.
  2. Sprawdź, czy cena nadal widnieje w kodzie źródłowym (`Ctrl + U`).
  3. Jeśli nie, poszukaj tagów meta w nagłówku strony, np. `<meta property="product:price:amount" content="199.99">` — selektor: `meta[property="product:price:amount"]` (wtedy pobierana jest wartość atrybutu).

### Problem 2: Błąd `403 Forbidden` / `BLOCKED`
- **Przyczyna**: System antybotowy sklepu (np. Cloudflare Bot Management) rozpoznał adres IP GitHub Actions.
- **Rozwiązanie**:
  1. Upewnij się, że masz skonfigurowany sekret `SCRAPER_API_KEY`.
  2. Bot automatycznie przekieruje nieudane zapytanie przez ScraperAPI.

### Problem 3: Selektor zwraca cenę wariantu lub raty zamiast ceny produktu
- **Przyczyna**: Zbyt ogólny selektor (np. `span.price`), który dopasował pierwszą cenę na stronie (np. "Rata od 25 zł/mies.").
- **Rozwiązanie**:
  - Zawęź selektor, dodając klasę kontenera głównego, np. `.product-main-info .product-price`.
