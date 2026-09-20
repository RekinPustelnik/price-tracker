#!/usr/bin/env node
// =============================================================================
// scripts/test-selector.js — Narzędzie CLI do szybkiego testowania selektorów
// =============================================================================
// Użycie:
//   node scripts/test-selector.js <url> [selektor_ceny] [selektor_rabatu]
//   npm run test-selector
// =============================================================================

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import * as cheerio from 'cheerio';
import { parsePrice, parseDiscountDomain, parsePromoExpiry } from '../src/scraper.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

function buildHeaders(url) {
  const origin = new URL(url).origin;
  return {
    'User-Agent': USER_AGENTS[0],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': origin + '/',
    'Cookie': 'localization=PL; cart_currency=PLN;',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  };
}

async function main() {
  console.log('================================================================');
  console.log('🛠️  Price Tracker — Tester selektorów CSS i stron sklepów');
  console.log('================================================================\n');

  let [, , url, selector, discountSelector] = process.argv;

  if (!url) {
    const rl = readline.createInterface({ input, output });
    try {
      url = await rl.question('🌐 Podaj adres URL produktu: ');
      url = url.trim();
      if (!url) {
        console.error('✗ Błąd: URL jest wymagany!');
        process.exit(1);
      }

      selector = await rl.question('🎯 Podaj selektor CSS ceny (np. .price, span.current-price): ');
      selector = selector.trim();

      discountSelector = await rl.question('🏷️  Podaj selektor CSS rabatu (opcjonalnie, Enter aby pominąć): ');
      discountSelector = discountSelector.trim();
    } finally {
      rl.close();
    }
  }

  if (!url) {
    console.error('✗ Podaj poprawny URL.');
    process.exit(1);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (err) {
    console.error(`✗ Błędny format URL: "${url}" (${err.message})`);
    process.exit(1);
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '');
  console.log(`\n🔍 Rozpoczynam test dla: ${hostname}`);
  console.log(`   URL: ${url}`);
  console.log(`   Selektor ceny:   ${selector || '(brak — zostanie pobrany tytuł i obrazek)'}`);
  console.log(`   Selektor rabatu: ${discountSelector || '(brak)'}\n`);

  console.log('⏳ Pobieranie strony...');
  const startTime = performance.now();

  let response;
  try {
    response = await fetch(url, {
      headers: buildHeaders(url),
      signal: AbortSignal.timeout(30_000),
      redirect: 'follow',
    });
  } catch (err) {
    console.error(`\n✗ Błąd połączenia HTTP: ${err.message}`);
    process.exit(1);
  }

  const durationMs = Math.round(performance.now() - startTime);
  console.log(`✓ Otrzymano odpowiedź HTTP ${response.status} ${response.statusText} (${durationMs} ms)`);

  if (!response.ok) {
    console.error(`✗ Serwer zwrócił błąd HTTP ${response.status}`);
    if ([400, 401, 403, 406, 429, 503].includes(response.status)) {
      console.log('⚠️  Wygląda na to, że sklep aktywował ochronę antybotową (np. Cloudflare / Akamai).');
      console.log('    Wskazówka: Skorzystaj z SCRAPER_API_KEY w pliku .env.');
    }
    process.exit(1);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Metadane OpenGraph / Favicon
  const pageTitle = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || '(brak tytułu)';
  let ogImage = $('meta[property="og:image"]').attr('content') ||
                $('meta[property="og:image:url"]').attr('content') ||
                $('meta[name="twitter:image"]').attr('content') ||
                $('meta[name="twitter:image:src"]').attr('content') ||
                null;

  if (ogImage) {
    try {
      ogImage = new URL(ogImage, url).href;
    } catch {
      ogImage = null;
    }
  }

  const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;

  console.log('\n--- Metadane produktu ---');
  console.log(`🏷️  Tytuł (og:title/title): ${pageTitle}`);
  console.log(`🖼️  Miniaturka (og:image):  ${ogImage || '(brak tagu og:image)'}`);
  console.log(`🌐 Favicon domeny:         ${faviconUrl}`);

  // Test selektora ceny
  if (selector) {
    console.log('\n--- Test selektora ceny ---');
    const matchedElements = $(selector);
    const count = matchedElements.length;

    console.log(`Liczba dopasowanych elementów: ${count}`);

    if (count === 0) {
      console.error(`✗ Selektor "${selector}" NIE pasuje do żadnego elementu w pobranym HTML!`);
      console.log('\n💡 Sugestie:');
      console.log('   - Sprawdź czy cena nie jest renderowana przez JavaScript po stronie klienta (SPA/React).');
      console.log('   - Sprawdź czy selektor nie zawiera dynamicznie generowanych klas CSS.');
      console.log('   - Szukam w HTML wystąpień symbolu waluty (zł / PLN)...');

      const matchesWithPln = [];
      $('*').each((_, el) => {
        const text = $(el).text();
        if ((text.includes('zł') || text.includes('PLN')) && text.length < 50 && text.trim().length > 2) {
          const cls = $(el).attr('class');
          if (cls && !matchesWithPln.includes(cls)) {
            matchesWithPln.push(cls);
          }
        }
      });

      if (matchesWithPln.length > 0) {
        console.log('   Znalezione potencjalne klasy z ceną:');
        matchesWithPln.slice(0, 5).forEach((cls) => console.log(`     .${cls.trim().split(/\s+/).join('.')}`));
      }
    } else {
      const firstText = matchedElements.first().text().trim();
      console.log(`Surowy tekst z pierwszego elementu: "${firstText}"`);

      const price = parsePrice(firstText);
      if (price !== null) {
        console.log(`✓ SUKCES! Sparsowana cena bazowa: ${price.toFixed(2)} zł`);
      } else {
        console.error(`✗ Nie udało się sparsować ceny z tekstu "${firstText}". Funkcja parsePrice zwróciła null.`);
      }

      if (count > 1) {
        console.log(`ℹ️  Wskazówka: Selektor dopasował ${count} elementów. Użyto pierwszego.`);
      }
    }
  }

  // Test selektora rabatu
  if (discountSelector) {
    console.log('\n--- Test selektora rabatu ---');
    const matchedDiscount = $(discountSelector);
    const count = matchedDiscount.length;
    console.log(`Liczba dopasowanych elementów rabatu: ${count}`);

    if (count === 0) {
      console.log(`ℹ️  Selektor rabatu "${discountSelector}" nie znalazł elementów na tej stronie (może brak aktywnej promocji).`);
    } else {
      const rawDiscountText = matchedDiscount.first().text().trim();
      console.log(`Surowy tekst rabatu: "${rawDiscountText}"`);

      const parsedDiscount = parseDiscountDomain(rawDiscountText, hostname);
      if (parsedDiscount) {
        console.log('✓ SUKCES! Sparsowano dane rabatu:');
        console.log(`   - Wartość:          ${parsedDiscount.value} (${parsedDiscount.isPercent ? '%' : parsedDiscount.isFinalPrice ? 'cena finalna zł' : 'zł'})`);
        console.log(`   - Wykryty kod:      ${parsedDiscount.couponCode || '(brak kodu)'}`);
        console.log(`   - Ważność promocji: ${parsedDiscount.expiresAt ? new Date(parsedDiscount.expiresAt * 1000).toLocaleString('pl-PL') : '(brak terminu)'}`);
        if (parsedDiscount.expiresAt) {
          console.log(`   - Discord dynamic:  <t:${parsedDiscount.expiresAt}:R>`);
        }
      } else {
        console.error(`✗ Nie udało się zdekodować rabatu z tekstu "${rawDiscountText}".`);
      }
    }
  }

  console.log('\n================================================================');
  console.log('Test zakończony pomyślnie!');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\nNieoczekiwany błąd:', err);
  process.exit(1);
});
