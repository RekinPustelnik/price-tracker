import { scrapePrice } from './scraper.js';
import { getProducts, getDomainConfig, updatePrice, incrementErrorCount } from './sheets.js';
import { sendPriceAlert, sendErrorAlert, sendSummary } from './discord.js';

const ERROR_ALERT_THRESHOLD = 5;

async function main() {
  console.log('=== Price Tracker — Start ===');
  console.log(`Data: ${new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
  console.log('');

  const domainConfig = await getDomainConfig();
  console.log(`Załadowano konfigurację dla ${Object.keys(domainConfig).length} domen z zakładki 'Domeny'.`);

  let products;
  try {
    products = await getProducts();
    console.log(`Znaleziono ${products.length} produktów do sprawdzenia w zakładce 'Produkty'.`);
  } catch (err) {
    console.error(`Błąd odczytu Google Sheets: ${err.message}`);
    process.exit(1);
  }

  if (products.length === 0) {
    console.log('Brak produktów w arkuszu — kończę.');
    return;
  }

  const stats = {
    total: products.length,
    checked: 0,
    priceDrops: 0,
    alerts: 0,
    blocked: 0,
    otherErrors: 0,
  };

  for (const product of products) {
    let hostname = '';
    try {
        hostname = new URL(product.url).hostname.replace(/^www\./, '');
    } catch(e) {}

    const selectorCeny = product.selektor || (domainConfig[hostname] ? domainConfig[hostname].priceSelector : '');
    const selectorRabatu = product.selektorRabatu || (domainConfig[hostname] ? domainConfig[hostname].discountSelector : '');

    console.log(`\n[${product.nazwa}] (${hostname})`);
    console.log(`  URL: ${product.url}`);
    
    if (!selectorCeny) {
        console.error(`  ✗ Brak selektora ceny (ani nadpisanego, ani domyślnego dla domeny) — pomijam`);
        stats.otherErrors++;
        try {
          const newCount = await incrementErrorCount(product.row, product.bledyZRzedu);
          if (newCount >= ERROR_ALERT_THRESHOLD && newCount % ERROR_ALERT_THRESHOLD === 0) {
            await sendErrorAlert(product, newCount, 'Brak selektora ceny (brak w arkuszu Produkty i Domeny)', '(brak)');
          }
        } catch (sheetErr) {
          console.error(`  ✗ Błąd zapisu licznika: ${sheetErr.message}`);
        }
        continue;
    }

    const result = await scrapePrice(product.url, selectorCeny, selectorRabatu, hostname);

    if (result.blocked) {
      const isFullMode = Boolean(process.env.SCRAPER_API_KEY);
      stats.blocked++;
      if (isFullMode) {
        console.error(`  ✗ Strona zablokowana (Anti-bot) w trybie pełnym — zwiększam licznik błędów`);
        try {
          const newCount = await incrementErrorCount(product.row, product.bledyZRzedu);
          if (newCount >= ERROR_ALERT_THRESHOLD && newCount % ERROR_ALERT_THRESHOLD === 0) {
            await sendErrorAlert(product, newCount, result.error || 'Strona zablokowana przez zabezpieczenia antybotowe', selectorCeny);
          }
        } catch (sheetErr) {
          console.error(`  ✗ Błąd zapisu licznika: ${sheetErr.message}`);
        }
      } else {
        console.error(`  ✗ Strona zablokowana (Anti-bot) w trybie szybkim — pomijam (oczekuje na pełny obieg)`);
      }
      continue;
    }

    if (result.error) {
      console.error(`  ✗ Nie udało się pobrać ceny: ${result.error} — pomijam`);
      stats.otherErrors++;
      try {
        const newCount = await incrementErrorCount(product.row, product.bledyZRzedu);
        if (newCount >= ERROR_ALERT_THRESHOLD && newCount % ERROR_ALERT_THRESHOLD === 0) {
          await sendErrorAlert(product, newCount, result.error, selectorCeny);
        }
      } catch (sheetErr) {
        console.error(`  ✗ Błąd zapisu licznika: ${sheetErr.message}`);
      }
      continue;
    }

    stats.checked++;
    const newPrice = result.price;
    let newDiscountedPrice = null;
    let discountStr = null;

    if (result.discount) {
      if (result.discount.isFinalPrice) {
         newDiscountedPrice = result.discount.value;
         const saved = newPrice - newDiscountedPrice;
         discountStr = result.discount.rawCode ? result.discount.rawCode : `-${saved.toFixed(2)} zł`;
      } else if (result.discount.isPercent) {
        newDiscountedPrice = newPrice * (1 - result.discount.value / 100);
        discountStr = result.discount.rawCode ? `${result.discount.rawCode} (-${result.discount.value}%)` : `-${result.discount.value}%`;
      } else {
        newDiscountedPrice = newPrice - result.discount.value;
        discountStr = result.discount.rawCode ? `${result.discount.rawCode} (-${result.discount.value.toFixed(2)} zł)` : `-${result.discount.value.toFixed(2)} zł`;
      }
      if (newDiscountedPrice < 0) newDiscountedPrice = 0;
      newDiscountedPrice = Math.round(newDiscountedPrice * 100) / 100;
    }

    const oldPrice = product.cena;
    const oldDiscountedPrice = product.cenaZRabatem;
    
    const lowest = product.najnizsza === null ? newPrice : Math.min(product.najnizsza, newPrice);
    let lowestDiscounted = product.najnizszaZRabatem;
    if (newDiscountedPrice !== null) {
        lowestDiscounted = lowestDiscounted === null ? newDiscountedPrice : Math.min(lowestDiscounted, newDiscountedPrice);
    }

    let bestDiscountStr = product.najwiekszyRabat;
    if (newDiscountedPrice !== null && newDiscountedPrice <= lowestDiscounted) {
        bestDiscountStr = discountStr;
    }

    console.log(`  Poprzednia cena: ${oldPrice ?? 'brak'} (z rabatem: ${oldDiscountedPrice ?? 'brak'})`);

    let isPriceDrop = false;
    if (oldPrice !== null && newPrice < oldPrice) isPriceDrop = true;
    if (oldDiscountedPrice !== null && newDiscountedPrice !== null && newDiscountedPrice < oldDiscountedPrice) isPriceDrop = true;

    let isAlertDrop = false;
    if (product.alertPonizej !== null) {
       if (newPrice <= product.alertPonizej || (newDiscountedPrice !== null && newDiscountedPrice <= product.alertPonizej)) {
          isAlertDrop = true;
       }
    }

    if (isPriceDrop) {
      console.log(`  📉 Spadek ceny!`);
      stats.priceDrops++;
      if (isAlertDrop) {
        console.log(`  🚨 ALERT: Cena poniżej progu ${product.alertPonizej}!`);
        stats.alerts++;
      }
      await sendPriceAlert(product, oldPrice, newPrice, oldDiscountedPrice, newDiscountedPrice, isAlertDrop, discountStr);
    } else if (oldPrice === null) {
      console.log(`  📝 Pierwsze sprawdzenie — zapisuję ceny`);
    } else {
      console.log(`  — Brak spadków (Baza: ${newPrice}, Rabat: ${newDiscountedPrice ?? 'brak'})`);
    }

    try {
      await updatePrice(product.row, {
        cena: newPrice,
        rabat: discountStr,
        cenaZRabatem: newDiscountedPrice,
        najnizsza: lowest,
        najnizszaZRabatem: lowestDiscounted,
        najwiekszyRabat: bestDiscountStr
      });
      console.log(`  ✓ Arkusz zaktualizowany`);
      if (product.bledyZRzedu > 0) {
        console.log(`  ✓ Licznik błędów zresetowany`);
      }
    } catch (err) {
      console.error(`  ✗ Błąd zapisu do Sheets: ${err.message}`);
      stats.otherErrors++;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

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
