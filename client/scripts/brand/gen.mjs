/**
 * 產生瀏覽器圖示、手機主畫面圖示與分享預覽圖，輸出到 client/public/。
 *
 * 用 Chromium 畫，才能用遊戲本身的字型與色票（分享圖的標題是 Noto Sans TC 900）。
 * 專案不依賴 Playwright，所以在官方的 Playwright 映像裡跑，repo 掛成 /c：
 *
 *     docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp \
 *       -v "$PWD/client":/c -w /c/scripts/brand \
 *       mcr.microsoft.com/playwright:v1.63.0-noble \
 *       sh -c 'npm i --no-save --prefix /tmp/pw playwright@1.63.0 >/dev/null && cp gen.mjs /tmp/pw/ && node /tmp/pw/gen.mjs'
 *
 * （ES module 的 import 不看 NODE_PATH，所以把這支腳本複製到裝了 playwright 的
 * 那個資料夾旁邊再跑；裡面的路徑都是絕對路徑，放哪裡跑都一樣。）
 *
 * 換了 logo 或標語之後重跑一次，把 public/ 底下那幾張一起 commit。
 */
import { chromium } from 'playwright';
const b = await chromium.launch();
// 透明底的小圖示（favicon）
for (const n of [16, 32, 48]) {
  const p = await b.newPage({ viewport: { width: n, height: n } });
  await p.goto('file:///c/scripts/brand/icon.html');
  await p.evaluate((n) => { const i = document.getElementById('img'); i.style.width = i.style.height = n + 'px'; }, n);
  await p.waitForTimeout(100);
  await p.screenshot({ path: `/c/public/favicon-${n}.png`, omitBackground: true });
  await p.close();
}
// 實心底的大圖示：iOS 會把透明填成黑色，所以自己鋪底並留邊（Android 的遮罩也要這圈留白）
for (const [n, name] of [[180, 'apple-touch-icon'], [192, 'icon-192'], [512, 'icon-512']]) {
  const p = await b.newPage({ viewport: { width: n, height: n } });
  await p.goto('file:///c/scripts/brand/icon.html');
  await p.evaluate((n) => {
    const box = document.getElementById('box'); box.style.cssText = `width:${n}px;height:${n}px;background:#070d16;background-image:radial-gradient(ellipse 120% 60% at 50% -10%,rgba(30,90,160,.45) 0%,transparent 60%)`;
    const i = document.getElementById('img'); i.style.width = i.style.height = Math.round(n * 0.7) + 'px';
  }, n);
  await p.waitForTimeout(100);
  await p.screenshot({ path: `/c/public/${name}.png` });
  await p.close();
}
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file:///c/scripts/brand/og.html', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: '/c/public/og.png' });
await b.close();
