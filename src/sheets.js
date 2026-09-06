// =============================================================================
// sheets.js — Odczyt i zapis danych w Google Sheets
// =============================================================================

import { google } from 'googleapis';

const COLUMNS = {
  NAZWA: 0,              // A
  URL: 1,                // B
  SELEKTOR: 2,           // C
  SELEKTOR_RABATU: 3,    // D
  CENA: 4,               // E
  RABAT: 5,              // F
  CENA_Z_RABATEM: 6,     // G
  NAJNIZSZA: 7,          // H
  NAJNIZSZA_Z_RABATEM: 8,// I
  NAJWIEKSZY_RABAT: 9,   // J
  ALERT_PONIZEJ: 10,     // K
  OSTATNIE_SPRAWDZENIE: 11, // L
  BLEDY_Z_RZEDU: 12,     // M
};

/**
 * Tworzy klienta autoryzacji Google Sheets API.
 */
function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

/**
 * Tworzy instancję Google Sheets API.
 */
async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

/**
 * Parsuje liczbę z arkusza (odporność na polski format z przecinkiem i spacjami).
 */
function parseSheetNumber(val) {
  if (!val) return null;
  const num = parseFloat(val.toString().replace(/\s/g, '').replace(',', '.'));
  return isNaN(num) ? null : num;
}

/**
 * Pobiera listę produktów z arkusza (pomija wiersz nagłówkowy).
 */
export async function getProducts() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A2:M1000', // Pomijamy wiersz 1, od A do M
  });

  const rows = response.data.values || [];

  return rows
    .map((row, index) => ({
      row: index + 2,
      nazwa: (row[COLUMNS.NAZWA] || '').trim(),
      url: (row[COLUMNS.URL] || '').trim(),
      selektor: (row[COLUMNS.SELEKTOR] || '').trim(),
      selektorRabatu: (row[COLUMNS.SELEKTOR_RABATU] || '').trim(),
      cena: parseSheetNumber(row[COLUMNS.CENA]),
      rabat: (row[COLUMNS.RABAT] || '').trim(),
      cenaZRabatem: parseSheetNumber(row[COLUMNS.CENA_Z_RABATEM]),
      najnizsza: parseSheetNumber(row[COLUMNS.NAJNIZSZA]),
      najnizszaZRabatem: parseSheetNumber(row[COLUMNS.NAJNIZSZA_Z_RABATEM]),
      najwiekszyRabat: (row[COLUMNS.NAJWIEKSZY_RABAT] || '').trim(),
      alertPonizej: parseSheetNumber(row[COLUMNS.ALERT_PONIZEJ]),
      bledyZRzedu: parseInt(row[COLUMNS.BLEDY_Z_RZEDU], 10) || 0,
    }))
    .filter((p) => p.nazwa && p.url && p.selektor);
}

/**
 * Aktualizuje cenę, rabaty i datę sprawdzenia, zerując licznik błędów.
 */
export async function updatePrice(row, updates) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  const now = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `E${row}`, values: [[updates.cena ?? '']] },
        { range: `F${row}`, values: [[updates.rabat ?? '']] },
        { range: `G${row}`, values: [[updates.cenaZRabatem ?? '']] },
        { range: `H${row}`, values: [[updates.najnizsza ?? '']] },
        { range: `I${row}`, values: [[updates.najnizszaZRabatem ?? '']] },
        { range: `J${row}`, values: [[updates.najwiekszyRabat ?? '']] },
        { range: `L${row}`, values: [[now]] },
        { range: `M${row}`, values: [[0]] },
      ],
    },
  });
}

/**
 * Zwiększa licznik błędów z rzędu dla danego produktu.
 */
export async function incrementErrorCount(row, currentCount) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  const newCount = currentCount + 1;
  const now = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: `L${row}`, // Ostatnie sprawdzenie
          values: [[now]],
        },
        {
          range: `M${row}`, // Błędy z rzędu
          values: [[newCount]],
        },
      ],
    },
  });

  return newCount;
}
