// =============================================================================
// discord.js — Powiadomienia na Discord przez webhook
// =============================================================================

/**
 * Wysyła alert o zmianie ceny na Discord.
 */
export async function sendPriceAlert(product, oldPrice, newPrice, oldDiscounted, newDiscounted, isBelowAlert, discountStr) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('  ⚠ Brak DISCORD_WEBHOOK_URL — pomijam powiadomienie');
    return;
  }

  const embed = {
    title: isBelowAlert
      ? '🚨 ALERT CENOWY — cena poniżej progu!'
      : '📉 Spadek ceny',
    description: `**[${product.nazwa}](${product.url})**`,
    color: isBelowAlert ? 0xff0000 : 0x00c853,
    fields: [
      {
        name: 'Cena bazowa',
        value: oldPrice ? `~~${oldPrice.toFixed(2)}~~  →  **${newPrice.toFixed(2)}**` : `**${newPrice.toFixed(2)}**`,
        inline: false,
      }
    ],
    footer: {
      text: 'Price Tracker',
    },
    timestamp: new Date().toISOString(),
  };

  if (newDiscounted !== null) {
    embed.fields.push({
      name: 'Cena z rabatem',
      value: oldDiscounted ? `~~${oldDiscounted.toFixed(2)}~~  →  **${newDiscounted.toFixed(2)}**` : `**${newDiscounted.toFixed(2)}**`,
      inline: true,
    });
    embed.fields.push({
      name: 'Złapany rabat',
      value: discountStr,
      inline: true,
    });
  }

  if (isBelowAlert) {
    embed.fields.push({
      name: '🎯 Próg alertu',
      value: `${product.alertPonizej.toFixed(2)}`,
      inline: true,
    });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!response.ok) {
      console.error(`  ✗ Discord webhook HTTP ${response.status}`);
    } else {
      console.log('  ✓ Powiadomienie Discord wysłane');
    }
  } catch (err) {
    console.error(`  ✗ Błąd Discord webhook: ${err.message}`);
  }
}

/**
 * Wysyła alert o powtarzających się błędach scrapowania na Discord.
 *
 * @param {object} product - Dane produktu z arkusza
 * @param {number} errorCount - Ile razy z rzędu wystąpił błąd
 * @param {string} errorMessage - Opis ostatniego błędu
 */
export async function sendErrorAlert(product, errorCount, errorMessage) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const embed = {
    title: '⚠️ Powtarzający się błąd scrapowania',
    description: `**[${product.nazwa}](${product.url})**`,
    color: 0xff9800, // pomarańczowy
    fields: [
      {
        name: 'Błędów z rzędu',
        value: `${errorCount}`,
        inline: true,
      },
      {
        name: 'Selektor',
        value: `\`${product.selektor}\``,
        inline: true,
      },
      {
        name: 'Ostatni błąd',
        value: errorMessage.substring(0, 200), // Ograniczenie do 200 znaków
      },
    ],
    footer: { text: 'Price Tracker — Sprawdź czy selektor jest nadal aktualny!' },
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    console.log('  ✓ Alert o błędach wysłany na Discord');
  } catch (err) {
    console.error(`  ✗ Błąd Discord webhook: ${err.message}`);
  }
}

/**
 * Wysyła podsumowanie po sprawdzeniu wszystkich produktów.
 */
export async function sendSummary(stats) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  // Wysyłaj podsumowanie tylko gdy były spadki cen
  if (stats.priceDrops === 0) return;

  const embed = {
    title: '📊 Podsumowanie sprawdzenia cen',
    color: 0x2196f3,
    fields: [
      { name: 'Sprawdzono', value: `${stats.checked}/${stats.total}`, inline: true },
      { name: 'Spadki cen', value: `${stats.priceDrops}`, inline: true },
      { name: 'Alerty', value: `${stats.alerts}`, inline: true },
    ],
    footer: { text: 'Price Tracker' },
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (err) {
    console.error(`Błąd wysyłania podsumowania: ${err.message}`);
  }
}
