// =============================================================================
// sheets.js — Odczyt i zapis danych w Google Sheets
// =============================================================================

import { google } from 'googleapis';

// Nazwy kolumn w arkuszu (wiersz 1 = nagłówki)
const COLUMNS = {
  NAZWA: 0,              // A
  URL: 1,                // B
  SELEKTOR: 2,           // C
  CENA: 3,               // D
  NAJNIZSZA: 4,          // E
  ALERT_PONIZEJ: 5,      // F
  OSTATNIE_SPRAWDZENIE: 6, // G
  BLEDY_Z_RZEDU: 7,      // H
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
    range: 'A2:H1000', // Pomijamy wiersz 1 (nagłówki), max 999 produktów
  });

  const rows = response.data.values || [];

  return rows
    .map((row, index) => ({
      row: index + 2, // Numer wiersza w arkuszu (1-indexed, +1 za nagłówek)
      nazwa: (row[COLUMNS.NAZWA] || '').trim(),
      url: (row[COLUMNS.URL] || '').trim(),
      selektor: (row[COLUMNS.SELEKTOR] || '').trim(),
      cena: parseSheetNumber(row[COLUMNS.CENA]),
      najnizsza: parseSheetNumber(row[COLUMNS.NAJNIZSZA]),
      alertPonizej: parseSheetNumber(row[COLUMNS.ALERT_PONIZEJ]),
      bledyZRzedu: parseInt(row[COLUMNS.BLEDY_Z_RZEDU], 10) || 0,
    }))
    .filter((p) => p.nazwa && p.url && p.selektor); // Filtruj puste/niekompletne wiersze
}

/**
 * Aktualizuje cenę, najniższą cenę, datę sprawdzenia i zeruje licznik błędów.
 *
 * @param {number} row - Numer wiersza w arkuszu (1-indexed)
 * @param {number} newPrice - Nowa cena
 * @param {number|null} currentLowest - Aktualnie najniższa zapisana cena
 */
export async function updatePrice(row, newPrice, currentLowest) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  const now = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
  const lowest = currentLowest === null ? newPrice : Math.min(currentLowest, newPrice);

  // Aktualizujemy kolumny D, E, G, H (Cena, Najniższa, Ostatnie sprawdzenie, Błędy z rzędu = 0)
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: `D${row}`, // Cena
          values: [[newPrice]],
        },
        {
          range: `E${row}`, // Najniższa
          values: [[lowest]],
        },
        {
          range: `G${row}`, // Ostatnie sprawdzenie
          values: [[now]],
        },
        {
          range: `H${row}`, // Błędy z rzędu — resetuj do 0
          values: [[0]],
        },
      ],
    },
  });
}

/**
 * Zwiększa licznik błędów z rzędu dla danego produktu.
 *
 * @param {number} row - Numer wiersza w arkuszu (1-indexed)
 * @param {number} currentCount - Aktualny licznik błędów
 * @returns {number} Nowa wartość licznika
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
          range: `G${row}`, // Ostatnie sprawdzenie
          values: [[now]],
        },
        {
          range: `H${row}`, // Błędy z rzędu
          values: [[newCount]],
        },
      ],
    },
  });

  return newCount;
}
