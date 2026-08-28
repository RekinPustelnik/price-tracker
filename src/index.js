// =============================================================================
// index.js — Główny skrypt: orkiestracja sprawdzania cen
// =============================================================================

import { scrapePrice } from './scraper.js';
import { getProducts, updatePrice } from './sheets.js';
import { sendPriceAlert, sendSummary } from './discord.js';

async function main() {
  console.log('=== Price Tracker — Start ===');
  console.log(`Data: ${new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
  console.log('');

  // 1. Pobierz listę produktów z Google Sheets
  let products;
  try {
    products = await getProducts();
    console.log(`Znaleziono ${products.length} produktów do sprawdzenia.`);
  } catch (err) {
    console.error(`Błąd odczytu Google Sheets: ${err.message}`);
    process.exit(1);
  }

  if (products.length === 0) {
    console.log('Brak produktów w arkuszu — kończę.');
    return;
  }

  // Statystyki do podsumowania
  const stats = {
    total: products.length,
    checked: 0,
    priceDrops: 0,
    alerts: 0,
    blocked: 0,      // Błędy 403 (strona blokuje / wyczerpany limit API)
    otherErrors: 0,   // Inne błędy (selektor nie działa, timeout, itp.)
  };

  // 2. Sprawdź cenę każdego produktu
  for (const product of products) {
    console.log(`\n[${product.nazwa}]`);
    console.log(`  URL: ${product.url}`);
    console.log(`  Selektor: ${product.selektor}`);

    // Scrapuj cenę
    const result = await scrapePrice(product.url, product.selektor);

    if (result === null) {
      console.error(`  ✗ Nie udało się pobrać ceny — pomijam`);
      stats.otherErrors++;
      continue;
    }

    if (result === 'BLOCKED') {
      console.error(`  ✗ Strona zablokowana (Anti-bot) — pomijam`);
      stats.blocked++;
      continue;
    }

    const newPrice = result;
    stats.checked++;
    const oldPrice = product.cena;

    console.log(`  Poprzednia cena: ${oldPrice ?? 'brak (pierwsze sprawdzenie)'}`);

    // 3. Porównaj z poprzednią ceną
    if (oldPrice !== null && newPrice < oldPrice) {
      // Cena spadła!
      const isBelowAlert = product.alertPonizej !== null && newPrice <= product.alertPonizej;

      console.log(`  📉 Spadek ceny: ${oldPrice} → ${newPrice}`);
      stats.priceDrops++;

      if (isBelowAlert) {
        console.log(`  🚨 ALERT: Cena poniżej progu ${product.alertPonizej}!`);
        stats.alerts++;
      }

      // Wyślij alert na Discord
      await sendPriceAlert(product, oldPrice, newPrice, isBelowAlert);
    } else if (oldPrice === null) {
      console.log(`  📝 Pierwsze sprawdzenie — zapisuję cenę ${newPrice}`);
    } else if (newPrice === oldPrice) {
      console.log(`  — Cena bez zmian: ${newPrice}`);
    } else {
      console.log(`  📈 Cena wzrosła: ${oldPrice} → ${newPrice}`);
    }

    // 4. Zapisz cenę do arkusza
    try {
      await updatePrice(product.row, newPrice, product.najnizsza);
      console.log(`  ✓ Arkusz zaktualizowany`);
    } catch (err) {
      console.error(`  ✗ Błąd zapisu do Sheets: ${err.message}`);
      stats.otherErrors++;
    }

    // Mała pauza między requestami żeby nie spamować
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // 5. Podsumowanie
  console.log('\n=== Podsumowanie ===');
  console.log(`Sprawdzono: ${stats.checked}/${stats.total}`);
  console.log(`Spadki cen: ${stats.priceDrops}`);
  console.log(`Alerty: ${stats.alerts}`);
  console.log(`Zablokowane (Anti-bot): ${stats.blocked}`);
  console.log(`Inne błędy: ${stats.otherErrors}`);

  await sendSummary(stats);

  console.log('\n=== Price Tracker — Koniec ===');
}

main().catch((err) => {
  console.error('Krytyczny błąd:', err);
  process.exit(1);
});
