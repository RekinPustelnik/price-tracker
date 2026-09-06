import { google } from 'googleapis';

const COLUMNS = {
  NAZWA: 0,
  URL: 1,
  SELEKTOR: 2,
  SELEKTOR_RABATU: 3,
  CENA: 4,
  RABAT: 5,
  CENA_Z_RABATEM: 6,
  NAJNIZSZA: 7,
  NAJNIZSZA_Z_RABATEM: 8,
  NAJWIEKSZY_RABAT: 9,
  ALERT_PONIZEJ: 10,
  OSTATNIE_SPRAWDZENIE: 11,
  BLEDY_Z_RZEDU: 12,
};

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

function parseSheetNumber(val) {
  if (!val) return null;
  const num = parseFloat(val.toString().replace(/\s/g, '').replace(',', '.'));
  return isNaN(num) ? null : num;
}

export async function getDomainConfig() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;
  
  let response;
  try {
    response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Domeny!A2:C100',
    });
  } catch (err) {
    console.warn(`  ⚠ Nie udało się pobrać zakładki 'Domeny'. Czy na pewno istnieje? Error: ${err.message}`);
    return {};
  }

  const rows = response.data.values || [];
  const config = {};
  
  for (const row of rows) {
     const domainStr = (row[0] || '').trim().toLowerCase();
     if (!domainStr) continue;
     
     // czyszczenie z https://, http://, www. i ścieżek
     let domain = domainStr.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
     
     config[domain] = {
        priceSelector: (row[1] || '').trim(),
        discountSelector: (row[2] || '').trim(),
     };
  }
  return config;
}

export async function getProducts() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  let response;
  try {
    response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Produkty!A2:M1000', 
    });
  } catch(err) {
    console.warn(`  ⚠ Próba pobrania z 'Produkty!' nieudana (zakładka może nazywać się inaczej), spadek do starej metody (Arkusz1).`);
    response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'A2:M1000', 
    });
  }

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
    .filter((p) => p.nazwa && p.url); // Wymagamy tylko nazwy i urla, selektor może być domyślny z Domen
}

export async function updatePrice(row, updates) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  const now = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
  const prefix = 'Produkty!'; // Zakładamy, że user utworzył zakładkę Produkty

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `${prefix}E${row}`, values: [[updates.cena ?? '']] },
        { range: `${prefix}F${row}`, values: [[updates.rabat ?? '']] },
        { range: `${prefix}G${row}`, values: [[updates.cenaZRabatem ?? '']] },
        { range: `${prefix}H${row}`, values: [[updates.najnizsza ?? '']] },
        { range: `${prefix}I${row}`, values: [[updates.najnizszaZRabatem ?? '']] },
        { range: `${prefix}J${row}`, values: [[updates.najwiekszyRabat ?? '']] },
        { range: `${prefix}L${row}`, values: [[now]] },
        { range: `${prefix}M${row}`, values: [[0]] },
      ],
    },
  });
}

export async function incrementErrorCount(row, currentCount) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  const newCount = currentCount + 1;
  const now = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
  const prefix = 'Produkty!';

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: `${prefix}L${row}`, 
          values: [[now]],
        },
        {
          range: `${prefix}M${row}`, 
          values: [[newCount]],
        },
      ],
    },
  });

  return newCount;
}
