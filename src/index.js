import { scrapePrice } from './scraper.js';
import { getProducts, getDomainConfig, updatePrice, incrementErrorCount } from './sheets.js';
import { sendPriceAlert, sendErrorAlert, sendSummary } from './discord.js';

const ERROR_ALERT_THRESHOLD = 5;

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('=== Price Tracker — Start ===');
  console.log(`Data: ${new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
  if (isDryRun) {
    console.log('🔍 [TRYB DRY-RUN — symulacja bez zapisu do Google Sheets i bez wysyłki powiadomień Discord]');
  }
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
        if (!isDryRun) {
          try {
            const newCount = await incrementErrorCount(product.row, product.bledyZRzedu);
            if (newCount >= ERROR_ALERT_THRESHOLD && newCount % ERROR_ALERT_THRESHOLD === 0) {
              await sendErrorAlert(product, newCount, 'Brak selektora ceny (brak w arkuszu Produkty i Domeny)', '(brak)');
            }
          } catch (sheetErr) {
            console.error(`  ✗ Błąd zapisu licznika: ${sheetErr.message}`);
          }
        } else {
          console.log(`  [DRY-RUN] Pomijam incrementErrorCount i sendErrorAlert`);
        }
        continue;
    }

    const result = await scrapePrice(product.url, selectorCeny, selectorRabatu, hostname);

    if (result.blocked) {
      console.error(`  ✗ Strona zablokowana (Anti-bot) — pomijam`);
      stats.blocked++;
      continue;
    }

    if (result.error) {
      console.error(`  ✗ Nie udało się pobrać ceny: ${result.error} — pomijam`);
      stats.otherErrors++;
      if (!isDryRun) {
        try {
          const newCount = await incrementErrorCount(product.row, product.bledyZRzedu);
          if (newCount >= ERROR_ALERT_THRESHOLD && newCount % ERROR_ALERT_THRESHOLD === 0) {
            await sendErrorAlert(product, newCount, result.error, selectorCeny);
          }
        } catch (sheetErr) {
          console.error(`  ✗ Błąd zapisu licznika: ${sheetErr.message}`);
        }
      } else {
        console.log(`  [DRY-RUN] Pomijam incrementErrorCount i sendErrorAlert`);
      }
      continue;
    }

    stats.checked++;
    const newPrice = result.price;
    let newDiscountedPrice = null;
    let discountStr = null;
    let couponCode = null;
    let promoExpiresAt = null;

    if (result.discount) {
      couponCode = result.discount.couponCode || null;
      promoExpiresAt = result.discount.expiresAt || null;

      if (result.discount.isFinalPrice) {
         newDiscountedPrice = result.discount.value;
         const saved = newPrice - newDiscountedPrice;
         discountStr = couponCode ? `Kod: ${couponCode} (-${saved.toFixed(2)} zł)` : `-${saved.toFixed(2)} zł`;
      } else if (result.discount.isPercent) {
        newDiscountedPrice = newPrice * (1 - result.discount.value / 100);
        discountStr = couponCode ? `Kod: ${couponCode} (-${result.discount.value}%)` : `-${result.discount.value}%`;
      } else {
        newDiscountedPrice = newPrice - result.discount.value;
        discountStr = couponCode ? `Kod: ${couponCode} (-${result.discount.value.toFixed(2)} zł)` : `-${result.discount.value.toFixed(2)} zł`;
      }
      if (newDiscountedPrice < 0) newDiscountedPrice = 0;
      newDiscountedPrice = Math.round(newDiscountedPrice * 100) / 100;
    }

    const oldPrice = product.cena;
    const oldDiscountedPrice = product.cenaZRabatem;

    // Obliczamy efektywne ceny (uwzględniając rabat jeśli istnieje)
    const effectiveOld = oldDiscountedPrice !== null ? oldDiscountedPrice : oldPrice;
    const effectiveNew = newDiscountedPrice !== null ? newDiscountedPrice : newPrice;
    
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

    // Spadek ceny jeśli efektywna cena spadła (np. pojawił się nowy rabat lub obniżono cenę)
    let isPriceDrop = false;
    if (effectiveOld !== null && effectiveNew < effectiveOld) {
      isPriceDrop = true;
    } else if (oldPrice !== null && newPrice < oldPrice) {
      isPriceDrop = true;
    }

    let isAlertDrop = false;
    if (product.alertPonizej !== null) {
       if (effectiveNew !== null && effectiveNew <= product.alertPonizej) {
          isAlertDrop = true;
       }
    }

    if (isPriceDrop) {
      console.log(`  📉 Spadek ceny! (Efektywna: ${effectiveOld} zł → ${effectiveNew} zł)`);
      stats.priceDrops++;
      if (isAlertDrop) {
        console.log(`  🚨 ALERT: Cena poniżej progu ${product.alertPonizej} zł!`);
        stats.alerts++;
      }
      if (!isDryRun) {
        await sendPriceAlert(
          product,
          oldPrice,
          newPrice,
          oldDiscountedPrice,
          newDiscountedPrice,
          isAlertDrop,
          discountStr,
          {
            couponCode,
            expiresAt: promoExpiresAt,
            ogImage: result.ogImage,
          }
        );
      } else {
        console.log(`  [DRY-RUN] Wysłano by alert cenowy Discord (ogImage: ${result.ogImage || 'brak'}, kod: ${couponCode || 'brak'})`);
      }
    } else if (oldPrice === null) {
      console.log(`  📝 Pierwsze sprawdzenie — zapisuję ceny`);
    } else {
      console.log(`  — Brak spadków (Baza: ${newPrice}, Rabat: ${newDiscountedPrice ?? 'brak'})`);
    }

    if (!isDryRun) {
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
    } else {
      console.log(`  [DRY-RUN] Symulacja zapisu do Sheets: cena=${newPrice}, rabat=${discountStr ?? 'brak'}, zRabatem=${newDiscountedPrice ?? 'brak'}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('\n=== Podsumowanie ===');
  console.log(`Sprawdzono: ${stats.checked}/${stats.total}`);
  console.log(`Spadki cen: ${stats.priceDrops}`);
  console.log(`Alerty: ${stats.alerts}`);
  console.log(`Zablokowane (Anti-bot): ${stats.blocked}`);
  console.log(`Inne błędy: ${stats.otherErrors}`);

  if (!isDryRun) {
    await sendSummary(stats);
  } else {
    console.log('[DRY-RUN] Pomijam wysyłkę podsumowania na Discord');
  }
  console.log('\n=== Price Tracker — Koniec ===');
}

main().catch((err) => {
  console.error('Krytyczny błąd:', err);
  process.exit(1);
});
