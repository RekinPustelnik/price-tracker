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

Jeśli polecenie zwraca poprawny tekst zawierający cenę, selektor nadaje się do wpisania w zakładce **`Domeny` (kolumna B — Selektor Ceny)** lub bezpośrednio w zakładce **`Produkty` (kolumna C — Selektor ceny override)**.

---

## 3. Dobre vs Złe Selektory

| Jakość | Przykładowy selektor | Dlaczego? |
|---|---|---|
| 🟢 **Doskonały** | `[itemprop="price"]` | Opiera się na semantyce Schema.org; rzadko zmienia się przy redesignie sklepu. |
| 🟢 **Bardzo dobry** | `.main-price__value`, `.product-price` | Wykorzystuje dedykowane, unikalne klasy komponentu cenowego. |
| 🟡 **Przeciętny** | `div.prices > span:first-child` | Może przestać działać, jeśli sklep doda np. etykietę "Promocja" lub "Najniższa cena z 30 dni". |
| 🔴 **Zły (kruchy)** | `#app > div:nth-child(2) > div:nth-child(4) > span:nth-child(3)` | Bardzo kruchy; dowolna zmiana struktury strony natychmiast go unieważni. |

---

## 4. Jak działa algorytm `parsePrice()`?

Funkcja `parsePrice(text)` zdefiniowana w [src/scraper.js](file:///D:/Programowanie/price-tracker/src/scraper.js) została zoptymalizowana pod kątem różnorodnych standardów formatowania cen w polskich i międzynarodowych sklepach:

### Przykłady konwersji:

| Wejściowy ciąg tekstowy | Przetworzenie | Wynik (`number`) |
|---|---|:---:|
| `"1 234,56 zł"` | Usunięcie spacji, zamiana `,` na `.` | `1234.56` |
| `"1.234,56 PLN"` | Usunięcie separatora tysięcy `.`, zamiana `,` na `.` | `1234.56` |
| `"1,234.56"` | Usunięcie `,` jako separatora tysięcy | `1234.56` |
| `"239,99 zł."` | Usunięcie kropki końcowej | `239.99` |
| `"  49,00  "` | Przycięcie białych znaków, zamiana `,` na `.` | `49.00` |
| `"99 zł"` | Liczba całkowita | `99` |

---

## 5. Jak działa ekstrakcja rabatów (`parseDiscountDomain`)?

Skrypt umożliwia podanie selektora rabatu w kolumnie **C zakładki `Domeny`** (lub nadpisanie w kolumnie **D zakładki `Produkty`**). Odczytany tekst jest przetwarzany w zależności od domeny:

1. **Wojas (`wojas.pl`)**:
   - Sklep podaje informację np. *"Ten produkt kupisz za 181.30 zł z kodem EXTRA30"*.
   - Skrypt wyciąga z tekstu kwotę `181.30` oraz kod rabatowy `EXTRA30` i traktuje tę kwotę jako bezpośrednią cenę finalną po rabacie.
2. **Modivo (`modivo.pl`)**:
   - Sklep wyświetla badge np. *"extra -20% Kod: SEPT"*.
   - Skrypt wyciąga wartość procentową (`20%`) oraz kod promocyjny, a następnie sam oblicza cenę po rabacie z ceny bazowej.
3. **Zalando (`zalando.pl`, domeny międzynarodowe)**:
   - Nie wymaga wpisywania selektora rabatu — kupony, ich wartości (twarda kwota lub procent) oraz warunki progowe pobierane są automatycznie ze skryptów cache GraphQL (`incentives`).
   - Dla rabatów kwotowych z progiem (np. 50 zł od 300 zł) system przelicza proporcjonalny rabat dla produktów tańszych niż próg (zakładając dobitkę koszyka do minimum + ok. 10 zł).
   - **Reguła stałego rabatu 25% (do 31.10.2026)**: System sprawdza ważność daty rabatu i porównuje go z aktualną promocją na stronie, wybierając korzystniejszy wariant.
4. **Logika domyślna (dla pozostałych sklepów)**:
   - Skrypt sprawdza, czy tekst zawiera znak `%`.
   - Jeśli tak, oblicza obniżkę procentową.
   - Jeśli nie, wyszukuje pierwszą liczbę w tekście (np. z ciągu `EXTRA30` wyciągnie `30`) lub traktuje kwotę jako rabat stały.

---

## 6. Przykładowe sprawdzone selektory

| Sklep | Selektor Ceny | Selektor Rabatu | Uwagi |
|---|---|---|---|
| **footshop.pl** | `[itemprop="price"]` | — | Pobiera cenę z mikrodanych Schema. |
| **modivo.pl** | `price > .price-container > .price-wrapper` | `promotion-badge` | Pobiera bazę i badge rabatowy. |
| **wojas.pl** | `#priceSelected` | `.box-list-product-code` | Wyciąga cenę z kodem EXTRA. |
| **zalando.pl** | `[data-testid="pdp-price-container"] span` | *(automat GraphQL)* | Rabat i progi wykrywane automatycznie + reguła 25% do 31.10.2026. Wymaga ScraperAPI (tryb pełny). |
| **guess.eu** | `.price .sales .value` | — | Omija starą cenę w `.price__strike-through-detail`. Wymaga ScraperAPI (Cloudflare). |
| **perfectblue.pl** | `p.price ins .amount, p.price .amount` | — | Obsługuje motyw Flatsome/WooCommerce. |
| **answear.com** | `[class*="Price__wrapper__"] [class*="priceSale"] span, [class*="Price__wrapper__"] [class*="priceRegular"]` | — | Dynamiczne klasy styli CSS. |
| **zibru.com** | `.price-item` | — | Standardowy Shopify. |

---

## 7. Typowe problemy i ich rozwiązywanie

### Problem 1: Cena zwraca `null` (brak elementu w HTML)
- **Przyczyna**: Strona to aplikacja Single Page Application (SPA), która ładuje cenę asynchronicznie przez JavaScript/API dopiero po załadowaniu szkieletu HTML.
- **Rozwiązanie**:
  1. Wyłącz JavaScript w przeglądarce (DevTools → Settings → Disable JavaScript) i odśwież stronę.
  2. Sprawdź, czy cena nadal widnieje w kodzie źródłowym (`Ctrl + U`).
  3. Jeśli element z ceną jest renderowany przez JS, a w źródle go nie ma, poszukaj tagów zawierających dane JSON (np. `application/ld+json`).

### Problem 2: Błąd `403 Forbidden` / `BLOCKED`
- **Przyczyna**: System antybotowy sklepu (np. Cloudflare Bot Management) rozpoznał zapytanie.
- **Rozwiązanie**:
  1. Upewnij się, że masz skonfigurowany sekret `SCRAPER_API_KEY` w repozytorium GitHub.
  2. Obieg pełny (`price-check-full.yml`) automatycznie przekieruje nieudane zapytanie przez proxy ScraperAPI.

### Problem 3: Selektor zwraca złą cenę (np. cenę wariantu lub raty)
- **Przyczyna**: Zbyt ogólny selektor (np. `span.price`), który dopasował pierwszą cenę na stronie (np. "Rata od 25 zł/mies.").
- **Rozwiązanie**:
  - Zawęź selektor, dodając klasę kontenera głównego produktu, np. `.product-main-info .product-price`.
