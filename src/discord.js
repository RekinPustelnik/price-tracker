// =============================================================================
// discord.js — Powiadomienia na Discord przez webhook
// =============================================================================

/**
 * Wysyła alert o zmianie ceny na Discord.
 *
 * @param {object} product - Dane produktu z arkusza
 * @param {number} oldPrice - Poprzednia cena
 * @param {number} newPrice - Nowa cena
 * @param {boolean} isBelowAlert - Czy cena spadła poniżej progu alertu
 */
export async function sendPriceAlert(product, oldPrice, newPrice, isBelowAlert) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('  ⚠ Brak DISCORD_WEBHOOK_URL — pomijam powiadomienie');
    return;
  }

  const diff = newPrice - oldPrice;
  const diffText = diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);
  const percentChange = (((newPrice - oldPrice) / oldPrice) * 100).toFixed(1);

  const embed = {
    title: isBelowAlert
      ? '🚨 ALERT CENOWY — cena poniżej progu!'
      : '📉 Spadek ceny',
    description: `**[${product.nazwa}](${product.url})**`,
    color: isBelowAlert ? 0xff0000 : 0x00c853,
    fields: [
      {
        name: 'Poprzednia cena',
        value: `~~${oldPrice.toFixed(2)}~~`,
        inline: true,
      },
      {
        name: 'Nowa cena',
        value: `**${newPrice.toFixed(2)}**`,
        inline: true,
      },
      {
        name: 'Zmiana',
        value: `${diffText} (${percentChange}%)`,
        inline: true,
      },
    ],
    footer: {
      text: 'Price Tracker',
    },
    timestamp: new Date().toISOString(),
  };

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
 * Wysyła podsumowanie po sprawdzeniu wszystkich produktów.
 *
 * @param {object} stats - Statystyki sprawdzenia
 * @param {number} stats.total - Łączna liczba produktów
 * @param {number} stats.checked - Sprawdzonych pomyślnie
 * @param {number} stats.priceDrops - Spadki cen
 * @param {number} stats.alerts - Alerty (poniżej progu)
 * @param {number} stats.errors - Błędy
 */
export async function sendSummary(stats) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  // Wysyłaj podsumowanie tylko gdy były spadki cen lub PRAWDZIWE błędy (nie 403)
  if (stats.priceDrops === 0 && stats.otherErrors === 0) return;

  const embed = {
    title: '📊 Podsumowanie sprawdzenia cen',
    color: 0x2196f3,
    fields: [
      { name: 'Sprawdzono', value: `${stats.checked}/${stats.total}`, inline: true },
      { name: 'Spadki cen', value: `${stats.priceDrops}`, inline: true },
      { name: 'Alerty', value: `${stats.alerts}`, inline: true },
      { name: 'Błędy', value: `${stats.errors}`, inline: true },
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
