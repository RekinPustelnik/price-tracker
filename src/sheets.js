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
 * Pobiera listę produktów z arkusza (pomija wiersz nagłówkowy).
 *
 * @returns {Promise<Array<{
 *   row: number,
 *   nazwa: string,
 *   url: string,
 *   selektor: string,
 *   cena: number|null,
 *   najnizsza: number|null,
 *   alertPonizej: number|null
 * }>>}
 */
export async function getProducts() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A2:G1000', // Pomijamy wiersz 1 (nagłówki), max 999 produktów
  });

  const rows = response.data.values || [];

  return rows
    .map((row, index) => ({
      row: index + 2, // Numer wiersza w arkuszu (1-indexed, +1 za nagłówek)
      nazwa: (row[COLUMNS.NAZWA] || '').trim(),
      url: (row[COLUMNS.URL] || '').trim(),
      selektor: (row[COLUMNS.SELEKTOR] || '').trim(),
      cena: parseFloat(row[COLUMNS.CENA]) || null,
      najnizsza: parseFloat(row[COLUMNS.NAJNIZSZA]) || null,
      alertPonizej: parseFloat(row[COLUMNS.ALERT_PONIZEJ]) || null,
    }))
    .filter((p) => p.nazwa && p.url && p.selektor); // Filtruj puste/niekompletne wiersze
}

/**
 * Aktualizuje cenę, najniższą cenę i datę sprawdzenia dla jednego produktu.
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

  // Aktualizujemy kolumny D, E, G (Cena, Najniższa, Ostatnie sprawdzenie)
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
      ],
    },
  });
}
