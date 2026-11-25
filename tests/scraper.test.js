import assert from 'node:assert/strict';
import { detectBotBlock, scrapePrice } from '../src/scraper.js';

console.log('Uruchamianie testów detekcji blokad i Next.pl w price-tracker...');

// 1. Kody HTTP
assert.equal(detectBotBlock(403), true);
assert.equal(detectBotBlock(429), true);
assert.equal(detectBotBlock(404), false);

// 2. Next.pl strona błędu z dużym nagłówkiem CSS/SVG (> 3000 znaków przed komunikatem)
{
  const padding = '<style>' + 'a{}'.repeat(1800) + '</style>';
  const nextErrorHtml = `<!DOCTYPE html><html><head>${padding}</head><body><h1>Oops, something went wrong.</h1><p>It appears that you have encountered a technical problem while browsing Next.co.uk.</p></body></html>`;
  assert.ok(nextErrorHtml.length > 4000);
  assert.equal(detectBotBlock(200, nextErrorHtml), true, 'Powinno wykryć błąd Akamai/Next powyżej 3000 bajtu');
}

// 3. Akamai Behavioral Challenge (HTTP 200, brak <title>)
{
  const challengeHtml = `<!DOCTYPE html><html><body><div id="sec-if-cpt-container"><p class="scf-akamai-protected-by">Powered and protected by</p></div></body></html>`;
  assert.equal(detectBotBlock(200, challengeHtml), true, 'Powinno wykryć challenge Akamai sec-if-cpt-container');
}

// 4. Normalna strona produktu Next.pl nie jest oznaczana jako blokada
{
  const okHtml = `<html><head><title>Portfel | Next</title></head><body><div data-testid="product-now-price"><span data-testid="product-now-price-now-text">Teraz</span><span>214 zł</span></div></body></html>`;
  assert.equal(detectBotBlock(200, okHtml), false);
}

// 5. scrapePrice dla next.pl: obie próby (z country_code=pl i bez) zablokowane -> blocked: true (bez nabijania błędów)
{
  const seenUrls = [];
  const padding = '<style>' + 'a{}'.repeat(1800) + '</style>';
  const blockedNextHtml = `<html><head>${padding}</head><body><p>It appears that you have encountered a technical problem while browsing Next.co.uk.</p></body></html>`;

  const res = await scrapePrice(
    'https://www.next.pl/pl/style/sv090352/v45077',
    '[data-testid="product-now-price"] > span:not([data-testid="product-now-price-now-text"])',
    '',
    'next.pl',
    {
      scraperApiKey: 'test-key',
      retryDelayMs: 0,
      fetchImpl: async (url) => {
        seenUrls.push(url);
        return { ok: true, status: 200, statusText: 'OK', text: async () => blockedNextHtml };
      },
    }
  );
  assert.equal(seenUrls.length, 2);
  assert.ok(seenUrls[0].includes('country_code=pl'), 'Pierwsza próba z country_code=pl');
  assert.ok(!seenUrls[1].includes('country_code=pl'), 'Druga próba po blokadzie bez country_code=pl');
  assert.equal(res.blocked, true, 'Blokada Next powinna zwrócić blocked: true');
  assert.equal(res.price, null);
}

// 6. scrapePrice dla next.pl: 1. próba PL zablokowana -> 2. próba bez country_code=pl zwraca cenę 214
{
  let attempt = 0;
  const res = await scrapePrice(
    'https://www.next.pl/pl/style/sv090352/v45077',
    '[data-testid="product-now-price"] > span:not([data-testid="product-now-price-now-text"])',
    '',
    'next.pl',
    {
      scraperApiKey: 'test-key',
      retryDelayMs: 0,
      fetchImpl: async () => {
        attempt++;
        if (attempt === 1) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => '<html><body><div id="sec-if-cpt-container"></div></body></html>',
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => '<html><head><title>Portfel Wallace i Gromit</title></head><body><div data-testid="product-now-price"><span data-testid="product-now-price-now-text">Teraz</span><span>214 zł</span></div></body></html>',
        };
      },
    }
  );
  assert.equal(attempt, 2);
  assert.equal(res.blocked, false);
  assert.equal(res.error, null);
  assert.equal(res.price, 214);
}

console.log('✅ Wszystkie testy price-tracker zakończone sukcesem!');
