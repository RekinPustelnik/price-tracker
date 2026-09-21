async function run() {
  const response = await fetch('https://www.zara.com/pl/pl/luzna-bluzka-z-%C5%82aczonej-dzianiny-p03653006.html?v1=594237920&v2=2419737', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept': 'text/html,application/xhtml+xml'
    }
  });
  const html = await response.text();
  console.log(html.substring(0, 500));
}
run();
