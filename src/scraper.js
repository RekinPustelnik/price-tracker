// =============================================================================
// scraper.js — Pobieranie HTML i wyciąganie ceny za pomocą CSS selektora
// =============================================================================

import * as cheerio from 'cheerio';

// Realistyczny User-Agent żeby strony nie blokowały requestów
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

/**
 * Pobiera stronę i wyciąga cenę za pomocą CSS selektora.
 *
 * @param {string} url - URL strony produktu
 * @param {string} selector - CSS selektor elementu z ceną
 * @returns {Promise<number|null>} Cena jako liczba lub null przy błędzie
 */
export async function scrapePrice(url, selector) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const rawText = $(selector).first().text().trim();

      if (!rawText) {
        throw new Error(`Selektor "${selector}" nie znalazł elementu lub element jest pusty`);
      }

      const price = parsePrice(rawText);

      if (price === null) {
        throw new Error(`Nie udało się sparsować ceny z tekstu: "${rawText}"`);
      }

      console.log(`  ✓ Cena: ${price} (tekst: "${rawText}")`);
      return price;
    } catch (err) {
      console.error(`  ✗ [Próba ${attempt}/${MAX_RETRIES}] ${err.message}`);

      if (attempt < MAX_RETRIES) {
        // Czekamy sekundę przed ponowną próbą
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  return null;
}

/**
 * Parsuje tekst ceny do liczby.
 * Obsługuje polskie i angielskie formaty:
 *   "1 234,56 zł"  →  1234.56
 *   "1,234.56"     →  1234.56
 *   "1234.56"      →  1234.56
 *   "1234,56"      →  1234.56
 *
 * @param {string} text - Surowy tekst ceny
 * @returns {number|null} Cena jako liczba lub null
 */
export function parsePrice(text) {
  // Usuń wszystko poza cyframi, kropkami, przecinkami
  let cleaned = text.replace(/[^\d.,]/g, '');

  if (!cleaned) return null;

  // Ustal separator dziesiętny:
  // Jeśli jest i kropka i przecinek — ten który jest później to separator dziesiętny
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > lastDot) {
    // Format: 1.234,56 lub 1234,56 (polski/europejski)
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // Format: 1,234.56 (angielski)
    cleaned = cleaned.replace(/,/g, '');
  }
  // Jeśli jest tylko jeden separator — sprawdź czy to dziesiętny
  else if (lastComma !== -1 && lastDot === -1) {
    // Tylko przecinek — jeśli ma 1-2 cyfry po nim, to separator dziesiętny
    const afterComma = cleaned.split(',')[1];
    if (afterComma && afterComma.length <= 2) {
      cleaned = cleaned.replace(',', '.');
    } else {
      // Przecinek jako separator tysięcy (np. "1,234")
      cleaned = cleaned.replace(',', '');
    }
  }

  const price = parseFloat(cleaned);
  return isNaN(price) || price <= 0 ? null : price;
}
