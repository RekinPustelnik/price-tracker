import * as cheerio from 'cheerio';
import fs from 'fs';

async function checkPrice() {
  const url = 'https://perfectblue.pl/produkt/gra-ps4-grimgrimoire-oncemore-deluxe-edition/';
  const response = await fetch(url);
  const html = await response.text();
  const $ = cheerio.load(html);
  
  const metaPrice = $('meta[property="product:price:amount"]').attr('content');
  const spanPrice = $('.price').text().trim();
  const amountPrice = $('.woocommerce-Price-amount').first().text().trim();
  
  console.log('meta price:', metaPrice);
  console.log('.price text:', spanPrice.replace(/\s+/g, ' '));
  console.log('.woocommerce-Price-amount:', amountPrice);
}

checkPrice().catch(console.error);
