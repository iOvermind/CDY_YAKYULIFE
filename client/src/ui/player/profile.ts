/**
 * 球員身上的文字標籤：守位／定位、慣用手、特性、感情狀態、榮譽的分組與排序。
 *
 * 記分板、結算卡與下載的生涯成績圖共用這一份。這裡不含 JSX。
 */
import { leagues, traits as traitsData, traitOf } from '../../data/index.ts';
import type { AwardRecord } from '../../engine/awards.ts';
import type { CareerSummary } from '../../engine/career.ts';
import type { PlayerState } from '../../engine/game.ts';
import { partnerProfile } from '../../engine/loveYear.ts';
import { joinName } from '../../engine/naming.ts';

/** 榮譽榜的一組：小標 ＋ 幾個標籤。 */
interface HonorGroup {
  readonly caption: string;
  readonly items: readonly string[];
}

/**
 * 榮譽的分組。**只有這一份**——畫面上的榮譽卡與下載的生涯成績圖共用它，各算
 * 各的遲早會分岔成兩種「榮譽」。
 *
 * 四組分開排，因為來源不同：
 *
 * - **職業獎項**冠上聯盟名並列出年份——「中職年度MVP」與「日職年度MVP」是
 *   兩件事，拆開才看得出一個旅外球員在哪裡拿的獎。
 * - **里程碑**是累積出來的，不是誰投票給你的。
 * - **養成期與國際賽**的榮譽沒有結構化紀錄，只有字串，因此照原樣列。
 * - **人生**不是獎項，但它是這個人的生涯的一部分——一個拿過五座 MVP 卻離了
 *   三次婚的人，與一個拿五座 MVP 且孩子坐滿看台的人，不是同一個故事。
 *
 * 空的組不回傳。標籤的樣式四組一致：每一組上面本來就寫著自己的小標，用形狀
 * 再編碼一次只是要求讀的人先學會那套編碼（見 tag.module.css 的 .tag）。
 */
export function honorGroups({
  awards,
  honors,
  summary,
  love,
}: {
  awards: readonly AwardRecord[];
  honors: readonly string[];
  summary: CareerSummary;
  love: PlayerState['love'];
}): HonorGroup[] {
  const milestones = [
    // 聯盟名與數字之間要留空白——「中職1000 安打」的中職與 1000 會黏成一團。
    ...summary.leagues.flatMap((l) => l.milestones.map((m) => `${l.orgName} ${m}`)),
    // 跨聯盟通算的那幾條也要冠上出處。同一排裡「大聯盟 2000 安打」旁邊擺一個
    // 沒有前綴的「3000 安打」，看起來像是漏字，而不是另一種計算方式。
    ...summary.careerMilestones.map((m) => `生涯 ${m}`),
  ];

  const tally = new Map<string, { label: string; years: number[] }>();
  for (const a of awards) {
    const league = leagues.top_league_names[a.org] ?? a.org;
    const key = `${a.org}:${a.code}`;
    const hit = tally.get(key);
    if (hit === undefined) tally.set(key, { label: joinName(league, a.name), years: [a.year] });
    else hit.years.push(a.year);
  }
  const shown = [...tally.values()].sort((a, b) => b.years.length - a.years.length);

  // 職業獎項已經由上面那份結構化紀錄列出來了，這裡只留養成期與國際賽的。
  const proLabels = new Set(shown.map((a) => a.label));
  const rest = sortHonors(honors.filter((h) => !proLabels.has(h)));

  return [
    {
      caption: '獎項',
      items: shown.map((a) => `${a.label}（${[...a.years].sort((x, y) => x - y).join('、')}）`),
    },
    { caption: '里程碑', items: milestones },
    { caption: '業餘與國際賽', items: rest },
    { caption: '人生', items: lifeTags(love) },
  ].filter((g) => g.items.length > 0);
}

/**
 * 目前帶著的特性，依資料檔的順序（正向在前、負向在後）。
 *
 * 名稱以取得當下解析的為準；沒有動態名稱的就用資料檔的固定名。這裡曾經把
 * `name` 為 null 的整個濾掉，於是三個動態命名的特性拿得到卻永遠看不到。
 *
 * 抽成函式是因為畫面上的狀態列與下載的生涯成績圖都要用它——兩邊各寫一份的話，
 * 圖上的特性遲早會跟畫面上的對不起來。
 */
export function shownTraits(
  owned: ReadonlySet<string>,
  names: ReadonlyMap<string, string>,
): { id: string; label: string; tone: string | undefined; effect_text: string; desc?: string }[] {
  const order = [...traitsData.categories.positive, ...traitsData.categories.negative];
  return order
    .filter((id) => owned.has(id))
    .map((id) => traitOf(id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map((t) => ({ ...t, label: names.get(t.id) ?? t.name ?? t.id }));
}

/**
 * 感情的狀態標籤：已婚或交往中的對象，點開看她的側寫。鹿鼎公兩位都列。單身與
 * 離婚不列——狀態列講的是「現在身邊是誰」。
 */
export function relationTags(state: PlayerState): { id: string; label: string; note: string }[] {
  const love = state.love;
  if (love.status !== 'married' && love.status !== 'dating') return [];
  const married = love.status === 'married';
  const years = married && love.marriedYear !== null ? `結婚 ${Math.max(0, state.year - love.marriedYear)} 年` : '';
  const kids = married && love.kids > 0 ? `孩子 ${love.kids} 個` : '';
  return [love.partner, love.partner2]
    .filter((n): n is string => n !== null)
    .map((name, i) => ({
      id: `partner-${i}`,
      label: `${married ? '已婚' : '交往'}：${name}`,
      note: [partnerProfile(name), years, kids].filter((s) => s !== '').join('｜'),
    }));
}

/** 結算時的【人生】標籤。婚姻、孩子與離婚各記一筆。 */
function lifeTags(love: PlayerState['love']): string[] {
  const out: string[] = [];
  if (love.status === 'married' && love.partner !== null) {
    // 三人行是一場婚禮、兩個名字——年表上不該只寫其中一位。
    const who = love.partner2 === null ? love.partner : `${love.partner}、${love.partner2}`;
    out.push(love.marriedYear === null ? `與${who}結婚` : `與${who}結婚（${love.marriedYear}）`);
  }
  if (love.kids > 0) out.push(`${love.kids} 個孩子`);
  if (love.divorces > 0) out.push(`離婚 ${love.divorces} 次`);
  return out;
}

/**
 * 姓名旁邊那個守位／定位標籤。記分板與生涯成績圖共用。
 *
 * 寫英文代碼（P＋DH），不寫「投手＋指定打擊」——姓名那一行還要擠慣用手，中文
 * 全稱會把它撐到換行。純投手只寫定位：先發、終結、布局、中繼、長中繼是五種
 * 不同的球員，一個沒有資訊量的 P 說不出他是哪一種。
 */
export function roleLabelOf(state: PlayerState): string {
  const pitcherRole = state.pitcherRole ?? 'P';
  if (!state.playsField) return pitcherRole;
  if (state.traits.has('two_way')) return `${pitcherRole}＋${state.position ?? 'DH'}`;
  return state.position ?? 'DH';
}

/**
 * 榮譽的顯示排序：繁體中文的預設定序就是筆劃順序。
 *
 * 明確指定 co-stroke 而不是依賴地區預設——不同引擎對 zh-Hant 的預設定序未必
 * 一致，寫死才不會在別的環境裡變成注音或碼位順序。
 */
const HONOR_COLLATOR = new Intl.Collator('zh-Hant-TW-u-co-stroke');

export function sortHonors(honors: readonly string[]): string[] {
  return [...honors].sort((a, b) => HONOR_COLLATOR.compare(a, b));
}

export const HAND_LABEL: Record<string, string> = { R: '右', L: '左', S: '左右開弓' };

export function hand(h: string): string {
  return h === 'S' ? '雙' : h === 'L' ? '左' : '右';
}
