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
const TIMEOUT_RENDER_MS = 90_000;

// Domeny SPA wymagające renderowania JavaScript w przeglądarce.
// Bezpośredni fetch zwraca challenge bota (Akamai/PerimeterX) zamiast HTML z ceną.
// Dla tych domen pomijamy fazę bezpośrednią i od razu używamy ScraperAPI z render=true.
const JS_RENDER_DOMAINS = [
  'zara.com',
];

/**
 * Sprawdza, czy dana domena wymaga renderowania JavaScript.
 */
function requiresJsRender(domain) {
  return JS_RENDER_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
}

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
    'Cookie': 'localization=PL; cart_currency=PLN;',
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

export async function scrapePrice(url, selector, discountSelector = '', domain = '') {
  let lastError = '';
  const needsRender = requiresJsRender(domain);

  // ── Domeny SPA (np. Zara): pomijamy bezpośredni fetch, od razu ScraperAPI z render=true ──
  if (needsRender) {
    const scraperApiKey = process.env.SCRAPER_API_KEY;
    if (!scraperApiKey) {
      console.log(`  ⚠ Domena ${domain} wymaga ScraperAPI z render=true, ale brak SCRAPER_API_KEY`);
      return {
        price: null,
        discount: null,
        ogImage: null,
        blocked: true,
        error: `Domena ${domain} wymaga renderowania JS (ScraperAPI z render=true), ale brak klucza SCRAPER_API_KEY`,
      };
    }

    console.log(`  → Domena SPA — ScraperAPI z render=true...`);
    const proxyUrl = `https://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(url)}&render=true&country_code=pl`;
    const renderResult = await fetchAndParse(proxyUrl, selector, discountSelector, {}, 2, domain, url, TIMEOUT_RENDER_MS);
    if (renderResult.price !== null) {
      return {
        price: renderResult.price,
        discount: renderResult.discount,
        ogImage: renderResult.ogImage,
        blocked: false,
        error: null,
      };
    }
    lastError = renderResult.lastError;

    if (renderResult.allBlocked) {
      return {
        price: null,
        discount: null,
        ogImage: null,
        blocked: true,
        error: lastError || `Strona ${domain} zablokowana nawet przez ScraperAPI z renderowaniem`,
      };
    }
    return { price: null, discount: null, ogImage: null, blocked: false, error: lastError };
  }

  // ── Standardowe domeny: Faza 1 (bezpośredni fetch) + Faza 2 (ScraperAPI fallback) ──
  console.log(`  → Próba bezpośrednia...`);
  const directResult = await fetchAndParse(url, selector, discountSelector, buildHeaders(url), 2, domain, url);
  if (directResult.price !== null) {
    return {
      price: directResult.price,
      discount: directResult.discount,
      ogImage: directResult.ogImage,
      blocked: false,
      error: null,
    };
  }
  lastError = directResult.lastError;

  const scraperApiKey = process.env.SCRAPER_API_KEY;
  if (scraperApiKey) {
    console.log(`  → Próba przez ScraperAPI...`);
    const proxyUrl = `https://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(url)}`;
    const proxyResult = await fetchAndParse(proxyUrl, selector, discountSelector, {}, 1, domain, url);
    if (proxyResult.price !== null) {
      return {
        price: proxyResult.price,
        discount: proxyResult.discount,
        ogImage: proxyResult.ogImage || directResult.ogImage,
        blocked: false,
        error: null,
      };
    }
    if (!proxyResult.allBlocked) lastError = proxyResult.lastError;
    console.log(`  ⚠ ScraperAPI nie pomogło (możliwe wyczerpanie limitu)`);
  }

  if (directResult.allBlocked) {
    return {
      price: null,
      discount: null,
      ogImage: null,
      blocked: true,
      error: lastError || 'Strona zablokowana przez zabezpieczenia antybotowe (np. Cloudflare/403)',
    };
  }
  return { price: null, discount: null, ogImage: null, blocked: false, error: lastError };
}

async function fetchAndParse(targetUrl, selector, discountSelector, headers, maxRetries, domain, originalUrl = targetUrl, timeoutMs = TIMEOUT_MS) {
  let allBlocked = true;
  let lastError = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(targetUrl, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
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

      // Ekstrakcja og:image / twitter:image (Feature 1)
      let ogImage = $('meta[property="og:image"]').attr('content') ||
                    $('meta[property="og:image:url"]').attr('content') ||
                    $('meta[name="twitter:image"]').attr('content') ||
                    $('meta[name="twitter:image:src"]').attr('content') ||
                    null;

      if (ogImage) {
        ogImage = ogImage.trim();
        try {
          ogImage = new URL(ogImage, originalUrl).href;
        } catch {
          ogImage = null;
        }
      }

      let effectiveSelector = selector;
      if (domain === 'perfectblue.pl' || domain === 'perfectblue.com') {
        if ($('meta[property="product:price:amount"]').length > 0) {
          effectiveSelector = 'meta[property="product:price:amount"]';
        }
      }

      const $el = $(effectiveSelector).first();
      let rawText = '';
      
      if ($el.is('meta')) {
        rawText = $el.attr('content') || '';
      } else if ($el.is('input')) {
        rawText = $el.val() || '';
      } else {
        rawText = $el.text().trim();
      }

      // Fallback dla domen SPA: jeśli główny selektor nie zadziałał, próbuj alternatyw
      if (!rawText && requiresJsRender(domain)) {
        console.log(`    ↳ Selektor "${effectiveSelector}" pusty — próbuję fallback (JSON-LD / meta / heurystyka)...`);
        rawText = extractPriceFallback($, domain);
      }

      if (!rawText) {
        throw new Error(`Selektor "${effectiveSelector}" nie znalazł elementu lub element jest pusty`);
      }

      const price = parsePrice(rawText);

      if (price === null) {
        throw new Error(`Nie udało się sparsować ceny z tekstu: "${rawText}"`);
      }
      
      let discount = null;
      if (discountSelector) {
        const rawDiscount = $(discountSelector).first().text().trim();
        if (rawDiscount) {
          discount = parseDiscountDomain(rawDiscount, domain);
        }
      }

      console.log(`  ✓ Cena: ${price} (tekst: "${rawText}")`);
      if (discount) {
        const info = discount.couponCode ? `kod: ${discount.couponCode}, wartość: ${discount.value}` : discount.value;
        console.log(`  ✓ Rabat: ${info}`);
      }
      return { price, discount, ogImage, allBlocked: false, lastError: '' };
    } catch (err) {
      lastError = err.message;
      console.error(`  ✗ [Próba ${attempt}/${maxRetries}] ${err.message}`);

      if (attempt < maxRetries) {
        const delay = 1000 + Math.random() * 2000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return { price: null, discount: null, ogImage: null, allBlocked, lastError };
}

/**
 * Heurystyczna ekstrakcja ceny z wyrenderowanego HTML domen SPA.
 * Próbuje kolejno: JSON-LD, meta tagi, przeszukiwanie DOM.
 * Zwraca surowy tekst ceny lub '' jeśli nie znaleziono.
 */
function extractPriceFallback($, domain) {
  // 1. JSON-LD (schema.org Product)
  const ldScripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < ldScripts.length; i++) {
    try {
      const json = JSON.parse($(ldScripts[i]).html());
      const price = findPriceInJsonLd(json);
      if (price) {
        console.log(`    ✓ Fallback: cena z JSON-LD = "${price}"`);
        return String(price);
      }
    } catch { /* ignoruj błędy parsowania JSON */ }
  }

  // 2. Meta tagi product:price:amount lub og:price:amount
  const metaPrice = $('meta[property="product:price:amount"]').attr('content') ||
                    $('meta[property="og:price:amount"]').attr('content') ||
                    $('meta[name="product:price:amount"]').attr('content');
  if (metaPrice) {
    console.log(`    ✓ Fallback: cena z meta tag = "${metaPrice}"`);
    return metaPrice;
  }

  // 3. Heurystyka DOM: szukamy krótkich tekstów z ceną (zł, PLN, €, lub sam format liczbowy)
  const pricePattern = /\d+[.,]\d{2}\s*(zł|PLN|€|EUR)?/;
  const candidates = [];
  $('*').each((_, el) => {
    const $node = $(el);
    // Pomijamy skrypty, style i elementy z wieloma dziećmi (kontenery)
    const tag = (el.tagName || el.name || '').toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
    
    const text = $node.clone().children().remove().end().text().trim();
    if (text && text.length < 30 && pricePattern.test(text)) {
      candidates.push(text);
    }
  });

  if (candidates.length > 0) {
    // Preferuj kandydatów z "zł" lub "PLN"
    const withCurrency = candidates.find(c => c.includes('zł') || c.includes('PLN'));
    const picked = withCurrency || candidates[0];
    console.log(`    ✓ Fallback: cena z heurystyki DOM = "${picked}" (z ${candidates.length} kandydatów)`);
    return picked;
  }

  console.log(`    ✗ Fallback: nie znaleziono ceny żadną metodą`);
  return '';
}

/**
 * Rekurencyjnie przeszukuje obiekt JSON-LD w poszukiwaniu ceny produktu.
 */
function findPriceInJsonLd(obj) {
  if (!obj || typeof obj !== 'object') return null;

  // Obsługa tablicy (np. @graph)
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const price = findPriceInJsonLd(item);
      if (price) return price;
    }
    return null;
  }

  // Sprawdź czy to obiekt Product/Offer z ceną
  if (obj['@type'] === 'Product' || obj['@type'] === 'Offer' ||
      obj['@type'] === 'AggregateOffer' ||
      (Array.isArray(obj['@type']) && (obj['@type'].includes('Product') || obj['@type'].includes('Offer')))) {
    // Bezpośrednia cena
    if (obj.price) return obj.price;
    // offers.price
    if (obj.offers) {
      const offersPrice = findPriceInJsonLd(obj.offers);
      if (offersPrice) return offersPrice;
    }
    // lowPrice / highPrice
    if (obj.lowPrice) return obj.lowPrice;
  }

  // Przeszukaj zagnieżdżone obiekty
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@')) continue;
    const val = obj[key];
    if (typeof val === 'object') {
      const price = findPriceInJsonLd(val);
      if (price) return price;
    }
  }
  return null;
}

export function parsePrice(text) {
  let cleaned = text.replace(/[^\d.,]/g, '');
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

/**
 * Parsuje datę lub godzinę wygaśnięcia promocji i zwraca UNIX timestamp w sekundach (dla Discord dynamic timestamp <t:UNIX:R>).
 * Obsługuje formaty: "do 15.09", "do 20.09.2026", "do 15 września", "do 23:59" itp.
 */
export function parsePromoExpiry(text) {
  if (!text) return null;

  const POLISH_MONTHS = {
    stycznia: 0, styczeń: 0,
    lutego: 1, luty: 1,
    marca: 2, marzec: 2,
    kwietnia: 3, kwiecień: 3,
    maja: 4, maj: 4,
    czerwca: 5, czerwiec: 5,
    lipca: 6, lipiec: 6,
    sierpnia: 7, sierpień: 7,
    września: 8, wrzesień: 8,
    października: 9, październik: 9,
    listopada: 10, listopad: 10,
    grudnia: 11, grudzień: 11,
  };

  const now = new Date();
  const currentYear = now.getFullYear();

  // 1. Format numeryczny: "do 15.09", "do 15.09.2026", "do 15.09 godz. 23:59"
  const numericMatch = text.match(/(?:do|ważn[ya]|ważne\s+do|obowiązuje\s+do)\s+(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?:\s+(?:godz\.?|o\s+godz\.?|o)?\s*(\d{1,2}):(\d{2}))?/i);
  if (numericMatch) {
    const day = parseInt(numericMatch[1], 10);
    const month = parseInt(numericMatch[2], 10) - 1;
    let year = numericMatch[3] ? parseInt(numericMatch[3], 10) : currentYear;
    if (year < 100) year += 2000;

    const hour = numericMatch[4] ? parseInt(numericMatch[4], 10) : 23;
    const minute = numericMatch[5] ? parseInt(numericMatch[5], 10) : 59;

    const date = new Date(year, month, day, hour, minute, 59);
    if (!isNaN(date.getTime())) {
      if (!numericMatch[3] && date.getTime() < now.getTime() - 30 * 24 * 3600 * 1000) {
        date.setFullYear(currentYear + 1);
      }
      return Math.floor(date.getTime() / 1000);
    }
  }

  // 2. Format słowny: "do 15 września", "do 15 września 2026", "do 15 września godz. 23:59"
  const monthsRegexStr = Object.keys(POLISH_MONTHS).join('|');
  const wordMatch = text.match(new RegExp(`(?:do|ważn[ya]|ważne\\s+do|obowiązuje\\s+do)\\s+(\\d{1,2})\\s+(${monthsRegexStr})(?:\\s+(\\d{4}))?(?:\\s+(?:godz\\.?|o\\s+godz\\.?|o)?\\s*(\\d{1,2}):(\\d{2}))?`, 'i'));
  if (wordMatch) {
    const day = parseInt(wordMatch[1], 10);
    const monthKey = wordMatch[2].toLowerCase();
    const month = POLISH_MONTHS[monthKey];
    const year = wordMatch[3] ? parseInt(wordMatch[3], 10) : currentYear;
    const hour = wordMatch[4] ? parseInt(wordMatch[4], 10) : 23;
    const minute = wordMatch[5] ? parseInt(wordMatch[5], 10) : 59;

    const date = new Date(year, month, day, hour, minute, 59);
    if (!isNaN(date.getTime())) {
      if (!wordMatch[3] && date.getTime() < now.getTime() - 30 * 24 * 3600 * 1000) {
        date.setFullYear(currentYear + 1);
      }
      return Math.floor(date.getTime() / 1000);
    }
  }

  // 3. Samo "do godz. 23:59" lub "do 23:59"
  const timeOnlyMatch = text.match(/(?:do\s+(?:godz\.?|godziny)?\s*)(\d{1,2}):(\d{2})/i);
  if (timeOnlyMatch) {
    const hour = parseInt(timeOnlyMatch[1], 10);
    const minute = parseInt(timeOnlyMatch[2], 10);
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 59);
    if (!isNaN(date.getTime())) {
      return Math.floor(date.getTime() / 1000);
    }
  }

  return null;
}

/**
 * Parsuje tekst rabatu w zależności od domeny.
 * Zwraca { value, isPercent, isFinalPrice, couponCode, expiresAt, rawCode }
 */
export function parseDiscountDomain(text, domain) {
  if (!text) return null;

  const expiresAt = parsePromoExpiry(text);
  
  if (domain === 'wojas.pl' || domain === 'wojas.com') {
    let finalPrice = null;
    let couponCode = null;
    const priceMatch = text.match(/za\s*([\d\s.,]+)\s*zł/i);
    if (priceMatch) finalPrice = parsePrice(priceMatch[1]);
    const codeMatch = text.match(/kodem\s*([a-zA-Z0-9_-]+)/i);
    if (codeMatch) couponCode = codeMatch[1].toUpperCase();
    if (finalPrice !== null) {
      return {
        isFinalPrice: true,
        value: finalPrice,
        couponCode,
        expiresAt,
        rawCode: couponCode ? `Kod: ${couponCode}` : null,
      };
    }
  }
  
  if (domain === 'modivo.pl') {
    let discountVal = null;
    let couponCode = null;
    const pctMatch = text.match(/([\d\s.,]+)\s*%/);
    if (pctMatch) discountVal = parsePrice(pctMatch[1]);
    const codeMatch = text.match(/(?:kod(?:em)?|code):\s*([a-zA-Z0-9_-]+)/i) ||
                      text.match(/(?:z\s+)?kodem\s+([a-zA-Z0-9_-]+)/i);
    if (codeMatch) couponCode = codeMatch[1].toUpperCase();
    if (discountVal !== null) {
      return {
        isPercent: true,
        value: discountVal,
        couponCode,
        expiresAt,
        rawCode: couponCode ? `Kod: ${couponCode}` : null,
      };
    }
  }
  
  // DEFAULT 
  const isPercent = text.includes('%');
  const match = text.match(/\d+(?:[.,\s]\d+)*/);
  if (!match) return null;

  const value = parsePrice(match[0]);
  if (value === null) return null;

  let couponCode = null;
  const genericCodeMatch = text.match(/(?:kod(?:em)?|code|rabat):\s*([a-zA-Z0-9_-]+)/i) ||
                           text.match(/(?:z\s+)?kodem\s+([a-zA-Z0-9_-]+)/i);
  if (genericCodeMatch) {
    couponCode = genericCodeMatch[1].toUpperCase();
  }

  return {
    value,
    isPercent,
    couponCode,
    expiresAt,
    rawCode: couponCode ? `Kod: ${couponCode}` : null,
  };
}
