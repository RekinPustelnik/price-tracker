// =============================================================================
// discord.js — Powiadomienia na Discord przez webhook
// =============================================================================

/**
 * Wysyła alert o zmianie ceny na Discord.
 */
export async function sendPriceAlert(
  product,
  oldPrice,
  newPrice,
  oldDiscounted,
  newDiscounted,
  isBelowAlert,
  discountStr,
  options = {}
) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('  ⚠ Brak DISCORD_WEBHOOK_URL — pomijam powiadomienie');
    return;
  }

  const { couponCode = null, expiresAt = null, ogImage = null, minOrderAmount = null, messageTemplate = null } = options;

  let domain = '';
  try {
    domain = new URL(product.url).hostname.replace(/^www\./, '');
  } catch (e) {}

  const embed = {
    title: isBelowAlert
      ? '🚨 ALERT CENOWY — cena poniżej progu!'
      : '📉 Spadek ceny',
    description: `**[${product.nazwa}](${product.url})**`,
    color: isBelowAlert ? 0xff0000 : 0x00c853,
    fields: [
      {
        name: 'Cena bazowa',
        value: oldPrice !== null ? `~~${oldPrice.toFixed(2)} zł~~  →  **${newPrice.toFixed(2)} zł**` : `**${newPrice.toFixed(2)} zł**`,
        inline: false,
      }
    ],
    footer: {
      text: 'Price Tracker',
    },
    timestamp: new Date().toISOString(),
  };

  // Feature 1: Author z faviconem sklepu
  if (domain) {
    embed.author = {
      name: domain,
      icon_url: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
      url: product.url,
    };
  }

  // Feature 1: Miniaturka produktu
  if (ogImage) {
    embed.thumbnail = { url: ogImage };
  }

  if (newDiscounted !== null) {
    embed.fields.push({
      name: 'Cena z rabatem',
      value: oldDiscounted !== null ? `~~${oldDiscounted.toFixed(2)} zł~~  →  **${newDiscounted.toFixed(2)} zł**` : `**${newDiscounted.toFixed(2)} zł**`,
      inline: true,
    });
    if (discountStr) {
      embed.fields.push({
        name: 'Złapany rabat',
        value: discountStr,
        inline: true,
      });
    }
  }

  // Feature 5: Kod rabatowy do 1-tap kopiowania
  if (couponCode) {
    embed.fields.push({
      name: '🏷️ Kod rabatowy',
      value: `\`${couponCode}\` *(kliknij, aby skopiować)*`,
      inline: true,
    });
  }

  // Warunki promocji (np. minimalna kwota zamówienia)
  if (messageTemplate || minOrderAmount) {
    let conditionText = '';
    if (minOrderAmount) {
      if (newPrice < minOrderAmount) {
        conditionText = `⚠️ Min. zamówienie: **${minOrderAmount.toFixed(2)} zł** (produkt poniżej min. kwoty — rabat wyliczony proporcjonalnie przy koszyku ~**${(minOrderAmount + 10).toFixed(2)} zł**)`;
      } else {
        conditionText = `⚠️ Min. zamówienie: **${minOrderAmount.toFixed(2)} zł**`;
      }
      if (messageTemplate) conditionText += `\n${messageTemplate}`;
    } else if (messageTemplate) {
      conditionText = messageTemplate;
    }

    embed.fields.push({
      name: '📋 Warunki promocji',
      value: conditionText.substring(0, 300),
      inline: false,
    });
  }

  // Feature 5: Odliczanie do wygaśnięcia promocji
  if (expiresAt) {
    embed.fields.push({
      name: '⏳ Ważność promocji',
      value: `<t:${expiresAt}:R> (<t:${expiresAt}:f>)`,
      inline: true,
    });
  }

  if (isBelowAlert) {
    embed.fields.push({
      name: '🎯 Próg alertu',
      value: `${product.alertPonizej.toFixed(2)} zł`,
      inline: true,
    });
  }

  // Feature 2: Interaktywne przyciski akcji (Link Buttons)
  const actionRowComponents = [
    {
      type: 2, // BUTTON
      style: 5, // LINK
      label: '🛒 Przejdź do oferty',
      url: product.url,
    },
  ];

  if (process.env.SPREADSHEET_ID) {
    actionRowComponents.push({
      type: 2, // BUTTON
      style: 5, // LINK
      label: '📊 Otwórz Arkusz',
      url: `https://docs.google.com/spreadsheets/d/${process.env.SPREADSHEET_ID}`,
    });
  }

  const payload = {
    embeds: [embed],
    components: [
      {
        type: 1, // ACTION_ROW
        components: actionRowComponents,
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
 * @param {string} selector - Użyty selektor
 */
export async function sendErrorAlert(product, errorCount, errorMessage, selector = '') {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  let domain = '';
  try {
    domain = new URL(product.url).hostname.replace(/^www\./, '');
  } catch (e) {}

  const usedSelector = selector || product.selektor || '(brak)';
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
        value: `\`${usedSelector}\``,
        inline: true,
      },
      {
        name: 'Ostatni błąd',
        value: (errorMessage || 'Nieznany błąd').substring(0, 200),
      },
    ],
    footer: { text: 'Price Tracker — Sprawdź czy selektor jest nadal aktualny!' },
    timestamp: new Date().toISOString(),
  };

  if (domain) {
    embed.author = {
      name: domain,
      icon_url: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
      url: product.url,
    };
  }

  const actionButtons = [
    {
      type: 2,
      style: 5,
      label: '🛒 Otwórz stronę produktu',
      url: product.url,
    },
  ];

  if (process.env.SPREADSHEET_ID) {
    actionButtons.push({
      type: 2,
      style: 5,
      label: '📊 Otwórz Arkusz',
      url: `https://docs.google.com/spreadsheets/d/${process.env.SPREADSHEET_ID}`,
    });
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [embed],
        components: [
          {
            type: 1,
            components: actionButtons,
          },
        ],
      }),
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

  const payload = { embeds: [embed] };

  if (process.env.SPREADSHEET_ID) {
    payload.components = [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: '📊 Otwórz Arkusz',
            url: `https://docs.google.com/spreadsheets/d/${process.env.SPREADSHEET_ID}`,
          },
        ],
      },
    ];
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`Błąd wysyłania podsumowania: ${err.message}`);
  }
}
