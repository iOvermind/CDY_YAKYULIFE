/**
 * 生涯成績圖：把一段生涯畫成一張可以存下來、傳出去的 PNG。
 *
 * **這裡只負責畫，不負責算。** 圖上的每一個字都由 App.tsx 先組成 `CareerCard`
 * 再送進來，而那些內容用的是畫面上同一批函式（`honorGroups`、`shownTraits`、
 * `careerRows`、`BATTING_COLUMNS`…）。分界劃在這裡的理由很實際：成績的算法只
 * 該有一份，圖跟畫面對不起來的話，玩家會拿圖來質疑畫面，而他是對的。
 *
 * 為什麼是 canvas 而不是把現有卡片截圖：這張圖的內容順序跟畫面不一樣（球員卡
 * 在最上面、引退之日插在中間），截圖套件仍得先兜出一份隱藏 DOM，換來的只是
 * 多一個依賴，外加 color-mix、backdrop-filter 這些它畫不出來的新 CSS。
 *
 * 配色與字體**跟著玩家當下的主題走**，直接讀 CSS 變數的計算值——四個主題各有
 * 各的顏色與字體，寫死一套等於讓其中三個主題的玩家拿到一張不像自己那局的圖。
 */

/** 一列成績。`tint` 是傷病年份的整列底色，與畫面上的年表同一個規則。 */
export interface CardRow {
  readonly cells: readonly string[];
  readonly tint: 'major' | 'minor' | null;
}

/** 一張成績表。`title` 是段落標題（生涯年表／各聯盟通算…），`caption` 是野手／投手。 */
export interface CardTable {
  readonly title: string | null;
  readonly caption: string | null;
  readonly head: readonly string[];
  readonly rows: readonly CardRow[];
  /** 靠左對齊的欄（球隊、聯盟、賽事這些文字欄）。其餘一律靠右——數字要對齊。 */
  readonly lefts: readonly number[];
}

export interface CareerCard {
  readonly name: string;
  /** 守位或投手定位，例如 `SS`、`SP`、`SP＋DH`。 */
  readonly role: string;
  /** 「投右打左」。 */
  readonly hands: string;
  readonly age: number;
  readonly year: number;
  readonly seed: string;
  /** 掛靴時的球隊與層級。沒打進職業的人是空字串。 */
  readonly team: string;
  readonly league: string;
  readonly traits: readonly { readonly label: string; readonly bad: boolean }[];
  /** 引退之日那張卡的內文（已經去掉 HTML）。 */
  readonly retire: string | null;
  readonly tables: readonly CardTable[];
  readonly honors: readonly { readonly caption: string; readonly items: readonly string[] }[];
}

/** 落款的網址。圖會被傳到看不見這個遊戲的地方，那時它是唯一的來源說明。 */
const SITE_URL = 'https://yakyulife.overmind.men';

/** 版面常數。單位是 CSS px，最後整張圖再乘上倍率輸出。 */
const PAD = 40;
const MIN_WIDTH = 820;
const MAX_WIDTH = 2000;
const GAP = 22;
const ROW_H = 22;
const CELL_PAD = 14;
const TAG_H = 24;
const TAG_PAD = 10;
const TAG_GAP = 8;

interface Palette {
  bg: string;
  panel: string;
  panel2: string;
  edge: string;
  text: string;
  dim: string;
  accent: string;
  bad: string;
  gold: string;
  radius: number;
  head: string;
  sans: string;
  mono: string;
}

function palette(): Palette {
  const css = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const radius = Number.parseFloat(v('--r', '10px'));
  return {
    bg: v('--bg', '#070d16'),
    panel: v('--panel', '#0e1826'),
    panel2: v('--panel2', '#16243a'),
    edge: v('--edge', '#24384f'),
    text: v('--text', '#dce6f2'),
    dim: v('--dim', '#8298b4'),
    accent: v('--accent', '#38bdf8'),
    bad: v('--bad', '#f2616b'),
    gold: v('--gold', '#f5c451'),
    radius: Number.isFinite(radius) ? Math.min(radius, 10) : 10,
    head: v('--head', 'sans-serif'),
    sans: v('--sans', 'sans-serif'),
    mono: v('--mono', 'monospace'),
  };
}

/**
 * 一段畫圖工作。`measure` 與 `paint` 走同一段程式，靠 `dry` 決定要不要真的下筆。
 *
 * 兩趟是必要的：整張圖多高，要把每一塊都排完才知道；而畫布一旦建立就不能改
 * 大小（改了會清空）。同一份程式跑兩次，排版與繪製就不可能對不上。
 */
interface Ctx {
  readonly c: CanvasRenderingContext2D;
  readonly p: Palette;
  readonly dry: boolean;
}

function font(p: Palette, size: number, family: 'head' | 'sans' | 'mono', weight = 400): string {
  return `${weight} ${size}px ${p[family]}`;
}

/** 把一段文字依寬度斷行。中文逐字斷、英數整串不切開。 */
function wrap(c: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      out.push('');
      continue;
    }
    const tokens = paragraph.match(/[A-Za-z0-9.,%+\-/']+|[\s\S]/g) ?? [];
    let line = '';
    for (const t of tokens) {
      const next = line + t;
      if (line !== '' && c.measureText(next).width > width) {
        out.push(line);
        line = t === ' ' ? '' : t;
      } else {
        line = next;
      }
    }
    if (line !== '') out.push(line);
  }
  return out;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** 一排標籤。回傳這一排佔的高度。 */
function tags(
  ctx: Ctx,
  items: readonly { label: string; bad: boolean }[],
  x: number,
  y: number,
  width: number,
): number {
  const { c, p } = ctx;
  c.font = font(p, 12, 'mono');
  let cx = x;
  let cy = y;
  for (const item of items) {
    const w = c.measureText(item.label).width + TAG_PAD * 2;
    if (cx > x && cx + w > x + width) {
      cx = x;
      cy += TAG_H + TAG_GAP;
    }
    if (!ctx.dry) {
      c.strokeStyle = item.bad ? p.bad : p.edge;
      c.fillStyle = p.panel2;
      roundRect(c, cx, cy, w, TAG_H, Math.min(p.radius, 4));
      c.fill();
      c.stroke();
      c.fillStyle = item.bad ? p.bad : p.text;
      c.textBaseline = 'middle';
      c.textAlign = 'left';
      c.fillText(item.label, cx + TAG_PAD, cy + TAG_H / 2 + 1);
    }
    cx += w + TAG_GAP;
  }
  return cy - y + TAG_H;
}

/** 段落標題。畫面上的 h4 前面有一顆小方塊，這裡照做。 */
function heading(ctx: Ctx, text: string, x: number, y: number): number {
  const { c, p } = ctx;
  if (!ctx.dry) {
    c.fillStyle = p.dim;
    c.font = font(p, 9, 'mono');
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText('■', x, y + 9);
    c.font = font(p, 13, 'head', 700);
    c.fillText(text, x + 14, y + 9);
  }
  return 20;
}

/** 一欄一欄量出寬度。表格的總寬決定整張圖的寬。 */
function columnWidths(c: CanvasRenderingContext2D, p: Palette, t: CardTable): number[] {
  c.font = font(p, 11, 'mono');
  const w = t.head.map((h) => c.measureText(h).width);
  c.font = font(p, 12, 'mono');
  for (const r of t.rows) {
    r.cells.forEach((cell, i) => {
      w[i] = Math.max(w[i] ?? 0, c.measureText(cell).width);
    });
  }
  return w.map((x) => Math.ceil(x) + CELL_PAD);
}

function table(ctx: Ctx, t: CardTable, x: number, y: number): number {
  const { c, p } = ctx;
  const widths = columnWidths(c, p, t);
  const lefts = new Set(t.lefts);
  let cy = y;

  if (t.caption !== null) {
    if (!ctx.dry) {
      c.fillStyle = p.dim;
      c.font = font(p, 11, 'head', 700);
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(t.caption, x, cy + 7);
    }
    cy += 18;
  }

  const cellX = (i: number): number => {
    let acc = x;
    for (let k = 0; k < i; k++) acc += widths[k] ?? 0;
    return acc;
  };
  const total = widths.reduce((a, b) => a + b, 0);

  // 表頭
  if (!ctx.dry) {
    c.font = font(p, 11, 'mono');
    c.fillStyle = p.dim;
    c.textBaseline = 'middle';
    t.head.forEach((h, i) => {
      const w = widths[i] ?? 0;
      c.textAlign = lefts.has(i) ? 'left' : 'right';
      const tx = lefts.has(i) ? cellX(i) + CELL_PAD / 2 : cellX(i) + w - CELL_PAD / 2;
      c.fillText(h, tx, cy + ROW_H / 2);
    });
    c.strokeStyle = p.edge;
    c.beginPath();
    c.moveTo(x, cy + ROW_H - 0.5);
    c.lineTo(x + total, cy + ROW_H - 0.5);
    c.stroke();
  }
  cy += ROW_H;

  // 資料列
  c.font = font(p, 12, 'mono');
  for (const r of t.rows) {
    if (!ctx.dry) {
      if (r.tint !== null) {
        c.globalAlpha = r.tint === 'major' ? 0.14 : 0.07;
        c.fillStyle = p.bad;
        c.fillRect(x, cy, total, ROW_H);
        c.globalAlpha = 1;
      }
      c.fillStyle = p.text;
      c.textBaseline = 'middle';
      r.cells.forEach((cell, i) => {
        const w = widths[i] ?? 0;
        c.textAlign = lefts.has(i) ? 'left' : 'right';
        const tx = lefts.has(i) ? cellX(i) + CELL_PAD / 2 : cellX(i) + w - CELL_PAD / 2;
        c.fillText(cell, tx, cy + ROW_H / 2);
      });
    }
    cy += ROW_H;
  }
  return cy - y;
}

/** 整張圖跑一趟。`dry` 時只算高度不下筆，回傳需要的總高。 */
function layout(ctx: Ctx, card: CareerCard, width: number): number {
  const { c, p } = ctx;
  const inner = width - PAD * 2;
  let y = PAD;

  // ── 球員卡
  if (!ctx.dry) {
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = p.text;
    c.font = font(p, 34, 'head', 900);
    c.fillText(card.name, PAD, y + 30);
  }
  const nameWidth = ((): number => {
    c.font = font(p, 34, 'head', 900);
    return c.measureText(card.name).width;
  })();
  if (!ctx.dry) {
    c.font = font(p, 15, 'sans');
    c.fillStyle = p.accent;
    c.fillText(`${card.role}・${card.hands}`, PAD + nameWidth + 14, y + 30);
  }
  y += 42;
  if (!ctx.dry) {
    c.font = font(p, 14, 'sans');
    c.fillStyle = p.dim;
    const where = card.team === '' ? `${card.year} 年・${card.age} 歲引退` : `${card.year} 年・${card.age} 歲引退於 ${card.team}・${card.league}`;
    c.fillText(where, PAD, y + 10);
    c.font = font(p, 11, 'mono');
    c.textAlign = 'right';
    c.fillText(`SEED ${card.seed}`, width - PAD, y + 10);
    c.textAlign = 'left';
  }
  y += 24;
  if (!ctx.dry) {
    c.strokeStyle = p.edge;
    c.beginPath();
    c.moveTo(PAD, y + 0.5);
    c.lineTo(width - PAD, y + 0.5);
    c.stroke();
  }
  y += GAP;

  // ── 狀態
  if (card.traits.length > 0) {
    y += heading(ctx, '狀態', PAD, y);
    y += tags(ctx, card.traits, PAD, y, inner) + GAP;
  }

  // ── 引退之日
  if (card.retire !== null) {
    y += heading(ctx, '引退之日', PAD, y);
    // 不畫外框：整張圖已經是一張卡了，裡面再套一層框只是把敘事關進盒子裡。
    c.font = font(p, 14, 'sans');
    const lines = wrap(c, card.retire, inner);
    if (!ctx.dry) {
      c.fillStyle = p.text;
      c.textBaseline = 'middle';
      c.textAlign = 'left';
      lines.forEach((line, i) => {
        c.fillText(line, PAD, y + i * 26 + 13);
      });
    }
    y += lines.length * 26 + GAP;
  }

  // ── 成績表
  let lastTitle: string | null = null;
  for (const t of card.tables) {
    if (t.title !== null && t.title !== lastTitle) {
      y += heading(ctx, t.title, PAD, y);
      lastTitle = t.title;
    }
    y += table(ctx, t, PAD, y) + 12;
  }
  if (card.tables.length > 0) y += GAP - 12;

  // ── 榮譽
  if (card.honors.length > 0) {
    y += heading(ctx, '榮譽', PAD, y);
    for (const g of card.honors) {
      if (!ctx.dry) {
        c.fillStyle = p.dim;
        c.font = font(p, 11, 'head', 700);
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.fillText(g.caption, PAD, y + 6);
      }
      y += 16;
      y += tags(ctx, g.items.map((label) => ({ label, bad: false })), PAD, y, inner) + 10;
    }
    y += GAP - 10;
  }

  // ── 落款。名字下面掛網址：圖會被傳到看不見這個遊戲的地方，那時它是唯一的
  //    來源說明。
  if (!ctx.dry) {
    c.fillStyle = p.dim;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.font = font(p, 11, 'mono');
    c.fillText('棒球生涯模擬器', PAD, y + 6);
    c.font = font(p, 11, 'mono');
    c.fillStyle = p.accent;
    c.fillText(SITE_URL, PAD, y + 24);
  }
  y += 34 + PAD;
  return y;
}

/**
 * 畫出來。
 *
 * 倍率從 2 起跳，但**面積有上限**——iOS Safari 對畫布的總像素數有限制，超過就
 * 什麼都不畫（而且不報錯，只回傳一張空白圖）。一段二十年的生涯配上兩張年表可以
 * 長到三千多點高，乘二就頂到那條線了，因此超過就降倍率，寧可稍微不那麼銳利也
 * 不要拿到空白圖。
 */
export async function renderCareerCard(card: CareerCard): Promise<HTMLCanvasElement> {
  // 字沒載完就量，量到的是備援字體的寬度，表格的欄寬會全部偏掉。
  if (document.fonts !== undefined) await document.fonts.ready;

  const p = palette();
  const probe = document.createElement('canvas').getContext('2d');
  if (probe === null) throw new Error('這個瀏覽器沒有 2D 畫布');

  // 寬度由最寬的那張表決定：表格不能橫向捲，切掉就等於沒有那幾欄。
  const widest = card.tables.reduce((max, t) => {
    const w = columnWidths(probe, p, t).reduce((a, b) => a + b, 0);
    return Math.max(max, w);
  }, 0);
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(widest) + PAD * 2));

  const height = Math.ceil(layout({ c: probe, p, dry: true }, card, width));

  const MAX_AREA = 11_000_000;
  let scale = 2;
  while (scale > 1 && width * height * scale * scale > MAX_AREA) scale -= 0.25;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const c = canvas.getContext('2d');
  if (c === null) throw new Error('這個瀏覽器沒有 2D 畫布');
  c.scale(scale, scale);
  c.fillStyle = p.bg;
  c.fillRect(0, 0, width, height);
  layout({ c, p, dry: false }, card, width);
  return canvas;
}

/**
 * 存下來。
 *
 * 手機優先走系統的分享面板——那裡才有「儲存影像」，而 `<a download>` 在 iOS
 * 上多半只是把圖開在同一個分頁裡。沒有分享能力的環境（桌面瀏覽器）就下載。
 */
export async function saveCareerCard(card: CareerCard): Promise<void> {
  const canvas = await renderCareerCard(card);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob === null) throw new Error('圖片產不出來');

  const name = `${card.name}-${card.year}-生涯成績.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] }) === true) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      // 使用者自己取消的話就到此為止，不要再偷偷下載一份。
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
