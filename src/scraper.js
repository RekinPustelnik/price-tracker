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

const TIMEOUT_MS = 45_000;

/**
 * Zwraca losowy User-Agent z listy.
 */
function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Buduje nagłówki udające prawdziwą przeglądarkę.
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
 * @returns {{ price: number, blocked: false, error: null }
 *         | { price: null, blocked: true, error: null }
 *         | { price: null, blocked: false, error: string }}
 */
export async function scrapePrice(url, selector) {
  let lastError = '';

  // FAZA 1: Spróbuj bezpośrednio (bez ScraperAPI)
  console.log(`  → Próba bezpośrednia...`);
  const directResult = await fetchAndParse(url, selector, buildHeaders(url), 2);
  if (directResult.price !== null) return { price: directResult.price, blocked: false, error: null };
  lastError = directResult.lastError;

  // FAZA 2: Jeśli bezpośrednio nie wyszło — spróbuj przez ScraperAPI (jeśli mamy klucz)
  const scraperApiKey = process.env.SCRAPER_API_KEY;
  if (scraperApiKey) {
    console.log(`  → Próba przez ScraperAPI...`);
    const proxyUrl = `https://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(url)}`;
    const proxyResult = await fetchAndParse(proxyUrl, selector, {}, 1);
    if (proxyResult.price !== null) return { price: proxyResult.price, blocked: false, error: null };
    // Użyj błędu z proxy tylko jeśli nie jest to problem z samym proxy
    if (!proxyResult.allBlocked) lastError = proxyResult.lastError;

    console.log(`  ⚠ ScraperAPI nie pomogło (możliwe wyczerpanie limitu)`);
  }

  // Jeśli wszystkie błędy to anti-bot → zablokowany
  if (directResult.allBlocked) return { price: null, blocked: true, error: null };

  // Inny błąd → zwróć opis
  return { price: null, blocked: false, error: lastError };
}

/**
 * Pomocnicza funkcja: pobiera HTML i parsuje cenę.
 *
 * @returns {Promise<{price: number|null, allBlocked: boolean, lastError: string}>}
 */
async function fetchAndParse(targetUrl, selector, headers, maxRetries) {
  let allBlocked = true;
  let lastError = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(targetUrl, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
      });

      if (!response.ok) {
        const blockedCodes = [400, 401, 403, 406, 429, 503];
        if (!blockedCodes.includes(response.status)) {
          allBlocked = false;
        }
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      allBlocked = false;

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
      return { price, allBlocked: false, lastError: '' };
    } catch (err) {
      lastError = err.message;
      console.error(`  ✗ [Próba ${attempt}/${maxRetries}] ${err.message}`);

      if (attempt < maxRetries) {
        const delay = 1000 + Math.random() * 2000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return { price: null, allBlocked, lastError };
}

/**
 * Parsuje tekst ceny do liczby.
 * Obsługuje polskie i angielskie formaty:
 *   "1 234,56 zł"  →  1234.56
 *   "1,234.56"     →  1234.56
 *   "1234.56"      →  1234.56
 *   "1234,56"      →  1234.56
 */
export function parsePrice(text) {
  let cleaned = text.replace(/[^\d.,]/g, '');

  // Usuń kropki i przecinki z początku i końca (np. "239,99 zł." → "239,99")
  cleaned = cleaned.replace(/^[.,]+|[.,]+$/g, '');

  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > lastDot) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    cleaned = cleaned.replace(/,/g, '');
  } else if (lastComma !== -1 && lastDot === -1) {
    const afterComma = cleaned.split(',')[1];
    if (afterComma && afterComma.length <= 2) {
      cleaned = cleaned.replace(',', '.');
    } else {
      cleaned = cleaned.replace(',', '');
    }
  }

  const price = parseFloat(cleaned);
  return isNaN(price) || price <= 0 ? null : price;
}
