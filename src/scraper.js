// =============================================================================
// scraper.js — Pobieranie HTML i wyciąganie ceny za pomocą CSS selektora
// =============================================================================

import * as cheerio from 'cheerio';

// Rotacja User-Agentów żeby zmniejszyć ryzyko blokady
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;

/**
 * Zwraca losowy User-Agent z listy.
 */
function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Buduje nagłówki udające prawdziwą przeglądarkę.
 * Wiele stron sprawdza te nagłówki i blokuje requesty bez nich.
 */
function buildHeaders(url) {
  const origin = new URL(url).origin;
  return {
    'User-Agent': randomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': origin + '/',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Sec-CH-UA': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="8"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Cache-Control': 'max-age=0',
  };
}

/**
 * Pobiera stronę i wyciąga cenę za pomocą CSS selektora.
 *
 * @param {string} url - URL strony produktu
 * @param {string} selector - CSS selektor elementu z ceną
 * @returns {Promise<number|null>} Cena jako liczba lub null przy błędzie
 */
export async function scrapePrice(url, selector) {
  // FAZA 1: Spróbuj bezpośrednio (bez ScraperAPI)
  // Wiele stron (zibru, desigual, perfectblue) działa bez proxy
  console.log(`  → Próba bezpośrednia...`);
  const directResult = await fetchAndParse(url, selector, buildHeaders(url), 2);
  if (directResult !== null) return directResult;

  // FAZA 2: Jeśli bezpośrednio nie wyszło — spróbuj przez ScraperAPI (jeśli mamy klucz)
  const scraperApiKey = process.env.SCRAPER_API_KEY;
  if (scraperApiKey) {
    console.log(`  → Próba przez ScraperAPI...`);
    const proxyUrl = `https://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(url)}`;
    const proxyResult = await fetchAndParse(proxyUrl, selector, {}, 1);
    if (proxyResult !== null) return proxyResult;

    // Jeśli ScraperAPI też zwróciło błąd — prawdopodobnie wyczerpany limit
    console.log(`  ⚠ ScraperAPI nie pomogło (możliwe wyczerpanie limitu)`);
  }

  return null;
}

/**
 * Pomocnicza funkcja: pobiera HTML i parsuje cenę.
 * Wydzielona żeby można było ją wywołać osobno dla trybu bezpośredniego i proxy.
 *
 * @param {string} targetUrl - URL do pobrania (bezpośredni lub przez proxy)
 * @param {string} selector - CSS selektor ceny
 * @param {object} headers - Nagłówki HTTP
 * @param {number} maxRetries - Maksymalna liczba prób
 * @returns {Promise<number|null>}
 */
async function fetchAndParse(targetUrl, selector, headers, maxRetries) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(targetUrl, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
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
      console.error(`  ✗ [Próba ${attempt}/${maxRetries}] ${err.message}`);

      if (attempt < maxRetries) {
        const delay = 1000 + Math.random() * 2000;
        await new Promise((resolve) => setTimeout(resolve, delay));
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

  // Usuń kropki i przecinki z samego początku i końca (np. kropka na końcu zdania "239,99 zł.")
  cleaned = cleaned.replace(/^[.,]+|[.,]+$/g, '');

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
