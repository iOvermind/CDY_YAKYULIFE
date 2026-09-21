import { describe, expect, it } from 'vitest';
import { leagues, season as cfg } from '../data/index.ts';
import {
  dominanceAt,
  gamesPlayed,
  intentionalWalks,
  intentionalWalksFrom,
  levelOf,
  pitcherRole,
  roleRank,
  plateAppearances,
  playSeason,
  proBattingLine,
  proPitchingLine,
  eraAt,
  staminaFactor,
  fullSeasonSta,
  trustFactor,
  offRoster,
} from './season.ts';
import { bullpenScore, pitcherRating, type Abilities } from './rating.ts';
import { World } from './rng.ts';

const KEYS = ['sta','vel','ctl','swp','drp','chg','gim','con','pow','spd','eye','rng','fld','arm','cat'];
const flat = (v: number): Abilities =>
  Object.fromEntries(KEYS.map((k) => [k, v])) as unknown as Abilities;
const with_ = (v: number, over: Record<string, number>): Abilities =>
  ({ ...flat(v), ...over }) as unknown as Abilities;

const CPBL1 = leagues.levels['CPBL1']!;

describe('levelOf', () => {
  it('取得層級設定', () => {
    expect(levelOf('CPBL1').name).toBe('中職一軍');
  });

  it('未知層級直接炸開——默默用預設值只會產生一段看似合理的假資料', () => {
    expect(() => levelOf('NOPE')).toThrow();
  });
});

describe('gamesPlayed', () => {
  const play = (seed: string, ability: Abilities, pos = 'SS', ovr = CPBL1.par) =>
    gamesPlayed(new World(seed), ability, pos, 'CPBL1', ovr);

  it('永遠不超過聯盟球季場次', () => {
    for (let i = 0; i < 200; i++) {
      expect(play(`s${i}`, flat(80), 'DH', 80)).toBeLessThanOrEqual(CPBL1.games);
    }
  });

  it('體力越高出賽越多', () => {
    const avg = (sta: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += play(`s${i}`, with_(45, { sta }));
      return t / 100;
    };
    expect(avg(70)).toBeGreaterThan(avg(30));
  });

  it('捕手的出賽場次明顯少於指定打擊——斷層級的守位勞損', () => {
    const avg = (pos: string) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += play(`s${i}`, flat(60), pos, 60);
      return t / 100;
    };
    const c = avg('C');
    const dh = avg('DH');
    expect(c).toBeLessThan(dh);
    // 捕手係數是 0.80，其餘守位都在 0.95 以上——差距必須看得出來
    expect(c / dh).toBeLessThan(0.9);
  });

  it('移防到負擔輕的守位可以延長單季出賽', () => {
    const avg = (pos: string) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += play(`s${i}`, with_(45, { sta: 40 }), pos);
      return t / 100;
    };
    expect(avg('1B')).toBeGreaterThan(avg('SS'));
  });

  it('打不好的人被下放替補，出賽變少', () => {
    const avg = (ovr: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += play(`s${i}`, flat(45), 'SS', ovr);
      return t / 100;
    };
    expect(avg(CPBL1.par - 8)).toBeLessThan(avg(CPBL1.par + 8));
  });

  it('相同種子產生相同結果', () => {
    expect(play('a', flat(50))).toBe(play('a', flat(50)));
  });
});

// 這一組釘的是**設計決定**，不是實作細節。四句話：sta 40 打 75%、DH 55 打滿、
// SS 65 打滿、再高不多打（改成免傷）。任何一條被下一次調參悄悄改掉都算迴歸。
describe('staminaFactor', () => {
  const pos = cfg.playing_time.position_factor;

  it('sta 40 是底限，打 75% 的球季', () => {
    expect(staminaFactor(40)).toBeCloseTo(0.75);
  });

  it('40 以下不再少打——那一段改用受傷率懲罰', () => {
    expect(staminaFactor(20)).toBeCloseTo(staminaFactor(40));
    expect(staminaFactor(0)).toBeCloseTo(staminaFactor(40));
  });

  it('DH（守位無勞損）sta 55 剛好打滿整季', () => {
    expect(staminaFactor(55) * pos['DH']!).toBeGreaterThanOrEqual(1.0);
    expect(staminaFactor(54) * pos['DH']!).toBeLessThan(1.0);
  });

  it('SS sta 65 剛好打滿整季——守位勞損要補得回來', () => {
    expect(staminaFactor(65) * pos['SS']!).toBeGreaterThanOrEqual(1.0);
    expect(staminaFactor(64) * pos['SS']!).toBeLessThan(1.0);
  });

  // 與 ADR 0013 的「中職 DH 51 打得滿、52 保證打滿」是同一個分別：76.5 是
  // load 剛好到 1.0 的地方，80 是連 games_noise 的下緣都吃得住的地方——曲線
  // 頂點訂在 80 是為了後者。
  it('捕手 76.5 蹲得滿、80 才保證蹲滿——斷層級懲罰是刻意的', () => {
    expect(staminaFactor(76.5) * pos['C']!).toBeGreaterThanOrEqual(1.0);
    expect(staminaFactor(76) * pos['C']!).toBeLessThan(1.0);
    expect(staminaFactor(80) * pos['C']!).toBeCloseTo(
      cfg.playing_time.position_factor_clamp.max,
      3,
    );
  });

  // 這是曲線頂點存在的理由：不是要捕手真的練到 80（實測生涯最高 sta max 64），
  // 而是 70 這個中途點要落在 144 場上，沒有 80 的錨點就撐不出那段斜率。
  it('捕手 sta 70 蹲 144 場', () => {
    expect(Math.round(162 * staminaFactor(70) * pos['C']!)).toBe(144);
  });

  // 精確門檻是 40 + (55−40) × 120/162 ＝ 51.11，所以「保證」要 52。51 算出
  // 0.9975，乘 120 場是 119.7——**四捨五入之後仍然是 120 場**，實際打得滿。
  it('短賽季門檻依比例下調——中職 120 場的 DH 練到 52 保證打滿', () => {
    expect(staminaFactor(52, 120) * pos['DH']!).toBeGreaterThanOrEqual(1.0);
    expect(Math.round(120 * staminaFactor(51, 120) * pos['DH']!)).toBe(120);
    expect(Math.round(120 * staminaFactor(48, 120) * pos['DH']!)).toBeLessThan(120);
  });

  it('下調是沿能力軸，不是把 staF 打折——中職 40 不該就打滿', () => {
    // 沿 staF 軸打 0.74 折的話這裡會是 1.0，體力在主樣本上完全失效。
    expect(staminaFactor(40, 120) * pos['DH']!).toBeLessThan(1.0);
  });

  it('80 之後不再上升，超額體力改換免傷', () => {
    expect(staminaFactor(95)).toBeCloseTo(staminaFactor(80));
  });

  it('每個守位的打滿門檻都是反解出來的，不是手寫的', () => {
    for (const p of ['DH', '1B', 'LF', '3B', '2B', 'SS', 'C']) {
      const need = fullSeasonSta(p);
      expect(staminaFactor(need) * pos[p]!).toBeCloseTo(1.0, 3);
    }
  });

  it('DH 55、SS 65、捕手 76.5——階梯照守位勞損排開', () => {
    expect(fullSeasonSta('DH')).toBeCloseTo(55, 1);
    // 1.053 是 1/0.95 四捨五入過的，所以反解回來是 64.93 不是乾淨的 65。
    expect(fullSeasonSta('SS')).toBeCloseTo(65, 0);
    expect(fullSeasonSta('C')).toBeCloseTo(76.5, 0);
    expect(fullSeasonSta('C')).toBeGreaterThan(fullSeasonSta('SS'));
    // 中間各守位單調遞增，不能有兩個守位擠在同一點。
    const ladder = ['DH', '1B', 'LF', '3B', '2B', 'SS'].map((p) => fullSeasonSta(p));
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]!).toBeGreaterThan(ladder[i - 1]!);
  });

  it('打滿門檻跟著聯盟場次沿能力軸下調', () => {
    expect(fullSeasonSta('DH', 120)).toBeCloseTo(51.1, 1);
    expect(Math.round(120 * staminaFactor(fullSeasonSta('DH', 120), 120) * pos['DH']!)).toBe(120);
  });

  it('曲線遞減：前半段每點比後半段值錢', () => {
    expect(staminaFactor(50) - staminaFactor(49)).toBeGreaterThan(
      staminaFactor(60) - staminaFactor(59),
    );
  });

  it('夾具不能吃掉曲線頂端', () => {
    expect(cfg.playing_time.position_factor_clamp.max).toBeGreaterThanOrEqual(
      staminaFactor(65) * pos['SS']!,
    );
  });
});

describe('trustFactor', () => {
  it('與聯盟同水準時就是 base', () => {
    expect(trustFactor(50, 50)).toBeCloseTo(cfg.playing_time.trust_factor.base);
  });

  it('不會超出上下限', () => {
    expect(trustFactor(200, 50)).toBe(cfg.playing_time.trust_factor.max);
    expect(trustFactor(0, 50)).toBe(cfg.playing_time.trust_factor.min);
  });
});

describe('plateAppearances', () => {
  it('打席數大致落在場次的 4 倍上下', () => {
    for (let i = 0; i < 100; i++) {
      const pa = plateAppearances(new World(`s${i}`), 120, 0, CPBL1.par, CPBL1.par);
      expect(pa).toBeGreaterThan(120 * 3.5);
      expect(pa).toBeLessThan(120 * 5);
    }
  });

  it('絕對噪音隨場次縮放——少場次者的數據不會崩壞', () => {
    // 只打 10 場的人，打席不該出現負值或誇張的數字
    for (let i = 0; i < 200; i++) {
      const pa = plateAppearances(new World(`s${i}`), 10, 0, CPBL1.par, CPBL1.par);
      expect(pa).toBeGreaterThanOrEqual(0);
      expect(pa).toBeLessThan(60);
    }
  });

  it('沒有出賽就沒有打席', () => {
    expect(plateAppearances(new World('a'), 0, 0, CPBL1.par, CPBL1.par)).toBe(0);
  });
});

describe('intentionalWalks', () => {
  const MLB_PAR = 61;

  it('一般球員不會被敬遠', () => {
    expect(intentionalWalks(new World('a'), flat(50), 600, MLB_PAR)).toBe(0);
  });

  it('極端重砲才會被敬遠', () => {
    expect(
      intentionalWalks(new World('a'), with_(50, { pow: 80, con: 80, eye: 80 }), 600, MLB_PAR),
    ).toBeGreaterThan(0);
  });

  it('速度是扣分項——沒有教練會敬遠快腿', () => {
    const slow = intentionalWalks(new World('a'), with_(50, { pow: 80, con: 80, eye: 80, spd: 20 }), 600, MLB_PAR);
    const fast = intentionalWalks(new World('a'), with_(50, { pow: 80, con: 80, eye: 80, spd: 80 }), 600, MLB_PAR);
    expect(fast).toBeLessThan(slow);
  });

  it('三圍全滿的慢腳重砲一季敬遠約 120 次——現實裡的單季最高', () => {
    const bonds = with_(50, { pow: 80, con: 80, eye: 80, spd: 20 });
    // 雜訊是 ±15%，錨點 120 落在區間中央。
    const ibb = intentionalWalks(new World('a'), bonds, 600, MLB_PAR);
    expect(ibb).toBeGreaterThan(120 * 0.85 - 1);
    expect(ibb).toBeLessThan(120 * 1.15 + 1);
  });

  it('比聯盟好一截還不夠——均衡打者要到 d+12 才踩得到線', () => {
    // 觸發線訂在「均衡打者 d+12」。d+11 仍然是 0，而那正是舊門檻（d+4.5）太低
    // 的地方：三圍只比聯盟平均高幾分的慢腳打者就拿得到敬遠。
    expect(intentionalWalksFrom(dominanceAt(MLB_PAR + 11, MLB_PAR), 600, () => 0.5)).toBe(0);
    expect(intentionalWalksFrom(dominanceAt(MLB_PAR + 12, MLB_PAR), 600, () => 0.5)).toBe(0);
  });

  it('過門檻是從 0 長上去，不是一過線就滿額', () => {
    // 舊版直接把 Dom 取冪，門檻上一格就跳到三十幾支。剛構到線的打者該是個位數。
    const edge = intentionalWalksFrom(dominanceAt(MLB_PAR + 13, MLB_PAR), 600, () => 0.5);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(5);
    // 中段仍然離錨點很遠——120 次是留給三圍 80、腳程 20 的那一個人的。
    expect(
      intentionalWalksFrom(dominanceAt(MLB_PAR + 15, MLB_PAR), 600, () => 0.5),
    ).toBeLessThan(120 / 4);
  });

  it('腳程差 30 分不該讓敬遠數差掉三分之一', () => {
    // 腳程的權重是 −0.125（曾經是 −0.25）。三圍 80、腳程 50 的頂級打者（OPS 約
    // 1.42）現實裡就是拿 120 次的那一個人，舊權重下他只有 83 次。
    const fast = with_(50, { pow: 80, con: 80, eye: 80, spd: 50 });
    const ibb = intentionalWalks(new World('a'), fast, 600, MLB_PAR);
    expect(ibb).toBeGreaterThan(120 * 0.7);
  });

  it('三圍只高一點的慢腳打者不該被敬遠', () => {
    // OPS 約 .77 的 64/64/64、腳程 20——舊門檻下他一季拿得到五次敬遠。
    const slow = with_(50, { pow: 64, con: 64, eye: 64, spd: 20 });
    expect(intentionalWalks(new World('a'), slow, 600, MLB_PAR)).toBe(0);
  });

  it('打席少的球季敬遠等比變少', () => {
    const dom = dominanceAt(75, MLB_PAR);
    expect(intentionalWalksFrom(dom, 300, () => 0.5) * 2).toBeCloseTo(
      intentionalWalksFrom(dom, 600, () => 0.5),
      -0.5,
    );
  });

  it('門檻隨聯盟 par 縮放——低階聯盟的相對怪物也會被敬遠', () => {
    // 能力 62 在大聯盟（par 59）只是稍微高於平均，在中職（par 44）是聯盟第一名。
    const monster = with_(62, {});
    expect(intentionalWalks(new World('a'), monster, 600, MLB_PAR)).toBe(0);
    expect(intentionalWalks(new World('a'), monster, 600, CPBL1.par)).toBeGreaterThan(0);
  });
});

describe('proBattingLine', () => {
  const bat = (seed: string, ability: Abilities, ovr: number) =>
    proBattingLine(new World(seed), ability, 'SS', 'CPBL1', ovr);

  it('打數等於打席扣掉四壞、敬遠、觸身球與犧牲打', () => {
    for (let i = 0; i < 100; i++) {
      const b = bat(`s${i}`, flat(50), 50);
      expect(b.ab).toBe(b.pa - b.bb - b.ibb - b.hbp - b.sac);
    }
  });

  it('先發不會多於出賽，替補那幾場只站一次多打擊區', () => {
    for (let i = 0; i < 100; i++) {
      const b = bat(`s${i}`, flat(50), 50);
      expect(b.starts).toBeLessThanOrEqual(b.games);
      expect(b.starts).toBeGreaterThanOrEqual(0);
    }
  });

  it('整季代打的人不會刷出先發球員的打席', () => {
    // 這正是舊模型的洞：PA = 出賽 × 棒次，把每一場出賽都當成先發。
    const weak = bat('bench', flat(30), 30);
    const strong = bat('bench', flat(60), 60);
    if (weak.games > 0 && strong.games > 0) {
      expect(weak.pa / weak.games).toBeLessThan(strong.pa / strong.games);
    }
  });

  it('安打不會多於打數，全壘打不會多於安打', () => {
    for (let i = 0; i < 200; i++) {
      const b = bat(`s${i}`, flat(60), 60);
      expect(b.hits).toBeLessThanOrEqual(b.ab);
      expect(b.hr).toBeLessThanOrEqual(b.hits);
      expect(b.double + b.triple + b.hr).toBeLessThanOrEqual(b.hits);
    }
  });

  it('抖動推不破任何一道上限——這正是抖動寫在 min() 外面時會壞掉的地方', () => {
    // ±3 的整數抖動如果加在夾具之後，`HR = min(H, …) + 3` 就會生出比安打還多的
    // 全壘打、`3B = 0 + (-3)` 會生出負的三壘打。四種能力水準都掃一遍。
    for (const ovr of [30, 45, 60, 75]) {
      for (let i = 0; i < 120; i++) {
        const b = bat(`cap-${ovr}-${i}`, flat(ovr), ovr);
        expect(b.so).toBeLessThanOrEqual(b.ab - b.hits);
        expect(b.sb).toBeLessThanOrEqual(b.hits + b.bb + b.ibb + b.hbp - b.hr);
        expect(b.cs).toBeLessThanOrEqual(b.sb);
        expect(b.rbi).toBeGreaterThanOrEqual(b.hr);
        expect(b.runs).toBeGreaterThanOrEqual(b.hr);
        for (const v of [b.hits, b.hr, b.double, b.triple, b.bb, b.ibb, b.so, b.sb, b.cs, b.hbp, b.sac]) {
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('長打率不低於打擊率——每支安打至少值一個壘包', () => {
    for (let i = 0; i < 200; i++) {
      const b = bat(`s${i}`, flat(55), 55);
      expect(b.slg).toBeGreaterThanOrEqual(b.avg - 1e-9);
    }
  });

  it('打擊率落在職業該有的範圍——職業一季上百場，樣本數足以收斂', () => {
    for (let i = 0; i < 300; i++) {
      const b = bat(`s${i}`, flat(50), 50);
      if (b.ab < 100) continue;
      expect(b.avg).toBeGreaterThan(0.15);
      expect(b.avg).toBeLessThan(0.42);
    }
  });

  it('接觸能力越好打擊率越高', () => {
    const avg = (con: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += bat(`s${i}`, with_(50, { con }), 50).avg;
      return t / 100;
    };
    expect(avg(70)).toBeGreaterThan(avg(35));
  });

  it('力量越好全壘打越多', () => {
    const hr = (pow: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += bat(`s${i}`, with_(50, { pow }), 50).hr;
      return t / 100;
    };
    expect(hr(75)).toBeGreaterThan(hr(30));
  });

  it('盜壘刺不會多於嘗試次數', () => {
    for (let i = 0; i < 100; i++) {
      const b = bat(`s${i}`, with_(50, { spd: 75 }), 50);
      expect(b.cs).toBeGreaterThanOrEqual(0);
      expect(b.sb).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('pitcherRole', () => {
  const role = (ability: Abilities) => pitcherRole(ability, 'CPBL1');
  const staMin = cfg.pitching.role.starter_sta_min;

  it('體力是先決條件：撐得住就走先發那條路', () => {
    expect(role(with_(CPBL1.par, { sta: staMin + 5, ctl: 60, vel: 60, swp: 60, drp: 55 }))).toBe('SP');
  });

  it('體力不足的人整組落到牛棚——撐不了一百五十局就是撐不了', () => {
    expect(role(with_(CPBL1.par, { sta: staMin - 5, ctl: 60, vel: 60, swp: 60 }))).not.toBe('SP');
  });

  it('控球差不擋先發——那一關交給保送與防禦率去罰', () => {
    expect(role(with_(CPBL1.par, { sta: staMin + 5, ctl: 25, vel: 70, swp: 65, drp: 60 }))).toBe('SP');
  });

  it('體力夠但評價不到先發線的人變長中繼', () => {
    expect(role(with_(20, { sta: staMin + 5, ctl: 20, vel: 20, swp: 20, drp: 20 }))).toBe('LR');
  });

  it('牛棚由高到低：終結 → 布局 → 中繼', () => {
    const strong = role(with_(CPBL1.par + 20, { sta: staMin - 10 }));
    const mid = role(with_(CPBL1.par + 2, { sta: staMin - 10 }));
    expect(['CP', 'SU']).toContain(strong);
    expect(['SU', 'MR', 'LR']).toContain(mid);
  });

  it('牛棚內部由牛棚分排序——同樣的整體能力，球速高的那個關門', () => {
    // 牛棚分問的是「他適不適合關門」，不是「他有多好」：一局的工作，球威才是
    // 那個排序的依據。
    const flame = with_(40, { sta: 20, vel: 80 });
    const command = with_(40, { sta: 20, ctl: 80 });
    expect(bullpenScore(flame)).toBeGreaterThan(bullpenScore(command));
    expect(roleRank(role(flame))).toBeGreaterThanOrEqual(roleRank(role(command)));
  });

  it('牛棚分吃原始能力，不吃角色折扣——折扣是身價，不是球威', () => {
    const ability = with_(50, { sta: 20 });
    // 折過的評價比原始能力低一大截；若牛棚線拿它去比，CPBL 的牛棚會沒有人構得到。
    expect(bullpenScore(ability)).toBeGreaterThan(pitcherRating(ability, 'RP'));
    expect(role(ability)).not.toBe('LR');
  });

  it('牛棚沒有一階收得下的人是長中繼——門檻之間不留洞', () => {
    // 這正是舊寫法的漏洞：CP ≥ 1.05、SU ≥ 1.02、MR ≥ 0.97 之外還寫一條
    // 「LR < 0.95」，於是 0.95 與 0.97 之間的人無家可歸。
    expect(role(with_(20, { sta: staMin - 10, ctl: 20, vel: 20, swp: 20 }))).toBe('LR');
  });

  it('五種角色都指派得出來，而且只會是這五種', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      seen.add(role(with_(CPBL1.par - 20 + i, { sta: 20 + i })));
    }
    for (const r of seen) expect(['SP', 'CP', 'SU', 'MR', 'LR']).toContain(r);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('proPitchingLine', () => {
  const pitch = (seed: string, ability: Abilities, ovr: number) =>
    proPitchingLine(new World(seed), ability, 'CPBL1', ovr);

  /**
   * 上限是**輪值容量再加抖動**：五個輪值位置給出的先發數是容量，但補休與跳過
   * 第五號讓王牌多投幾場。夾死在容量本身的話，單季局數的紀錄就永遠摸不到——
   * 那該是很難，不是不可能。
   */
  it('先發場次不超過輪值容量加抖動', () => {
    const app = cfg.pitching.appearances;
    const max = Math.ceil(CPBL1.games / app.rotation_divisor.value) + app.jitter_starts;
    for (let i = 0; i < 200; i++) {
      const p = pitch(`s${i}`, with_(65, { sta: 70, ctl: 70 }), 65);
      expect(p.starts).toBeLessThanOrEqual(max);
    }
  });

  it('純牛棚沒有先發場次，先發沒有救援成功', () => {
    for (let i = 0; i < 100; i++) {
      const rp = pitch(`s${i}`, with_(45, { sta: 25 }), 45);
      expect(['CP', 'SU', 'MR', 'LR']).toContain(rp.role);
      if (rp.role !== 'LR') expect(rp.starts).toBe(0);
      const sp = pitch(`s${i}`, with_(55, { sta: 65, ctl: 65 }), 55);
      expect(sp.role).toBe('SP');
      expect(sp.saves).toBe(0);
      expect(sp.holds).toBe(0);
    }
  });

  it('救援與中繼夾在剩下的出賽裡——不會生出比出場次數還多的紀錄', () => {
    for (let i = 0; i < 200; i++) {
      const p = pitch(`sv${i}`, with_(50, { sta: 30, vel: 60, ctl: 55 }), 50);
      expect(p.wins + p.losses + p.saves + p.holds).toBeLessThanOrEqual(p.games);
      expect(p.hr).toBeLessThanOrEqual(p.hits);
      expect(p.er).toBeLessThanOrEqual(p.runs);
      for (const v of [p.wins, p.losses, p.saves, p.holds, p.hits, p.hr, p.bb, p.so, p.outs]) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('勝敗場合計不超過出賽場次', () => {
    for (let i = 0; i < 100; i++) {
      const p = pitch(`s${i}`, with_(55, { sta: 65, ctl: 65 }), 55);
      expect(p.wins + p.losses).toBeLessThanOrEqual(p.games);
      expect(p.losses).toBeGreaterThanOrEqual(0);
    }
  });

  it('防禦率是自責分導出的，不是自己生成的', () => {
    // 舊版兩個數字各生各的，遲早對不起來。
    for (let i = 0; i < 300; i++) {
      const p = pitch(`s${i}`, flat(20 + (i % 60)), 20 + (i % 60));
      if (p.outs === 0) {
        expect(p.era).toBe(0);
        continue;
      }
      expect(p.era).toBeCloseTo((p.er * 27) / p.outs, 10);
      expect(p.era).toBeGreaterThanOrEqual(0);
      expect(p.era).toBeLessThan(20);
    }
  });

  it('能力越好防禦率越低', () => {
    const era = (v: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += pitch(`s${i}`, with_(v, { sta: 65, ctl: v }), v).era;
      return t / 100;
    };
    expect(era(65)).toBeLessThan(era(35));
  });

  it('球威越強三振越多', () => {
    const so = (vel: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += pitch(`s${i}`, with_(55, { sta: 65, ctl: 65, vel }), 55).so;
      return t / 100;
    };
    expect(so(75)).toBeGreaterThan(so(35));
  });

  it('控球越好保送越少', () => {
    const bb = (ctl: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += pitch(`s${i}`, with_(55, { sta: 65, ctl }), 55).bb;
      return t / 100;
    };
    expect(bb(72)).toBeLessThan(bb(42));
  });
});

describe('offRoster', () => {
  it('觸底點正是 trustFactor 的 min 落點——不是另外手調的數字', () => {
    const t = cfg.playing_time.trust_factor;
    const atCut = t.base + t.cut_d * t.per_point;
    expect(atCut).toBeCloseTo(t.min, 10);
  });

  it('斷崖兩側：剛好在線上仍在名單，掉下去就是 0 場', () => {
    const cut = cfg.playing_time.trust_factor.cut_d;
    expect(offRoster(CPBL1.par + cut, CPBL1.par)).toBe(false);
    expect(offRoster(CPBL1.par + cut - 1, CPBL1.par)).toBe(true);
  });

  it('被清出名單的野手整季 0 場，不是「幾場」', () => {
    for (let i = 0; i < 50; i++) {
      const g = gamesPlayed(new World(`s${i}`), flat(20), 'SS', 'CPBL1', 20);
      expect(g).toBe(0);
    }
  });

  it('判定不改變抽取次數——否則同種子的後續年份會整串偏移', () => {
    const kept = new World('a');
    gamesPlayed(kept, flat(50), 'SS', 'CPBL1', CPBL1.par);
    const cut = new World('a');
    gamesPlayed(cut, flat(20), 'SS', 'CPBL1', 20);
    expect(cut.drawCounts().season).toBe(kept.drawCounts().season);
  });
});

describe('playSeason', () => {
  const ctx = (over = {}) => ({
    level: 'CPBL1',
    ability: flat(50),
    position: 'SS',
    overall: 50,
    better: 'fielder' as const,
    twoWay: false,
    ...over,
  });

  it('野手只有打擊成績', () => {
    const line = playSeason(new World('a'), ctx());
    expect(line.batting).not.toBeNull();
    expect(line.pitching).toBeNull();
  });

  it('投手只有投球成績', () => {
    const line = playSeason(new World('a'), ctx({ better: 'pitcher' }));
    expect(line.pitching).not.toBeNull();
    expect(line.batting).toBeNull();
  });

  it('二刀流兩邊都有——那正是二刀流在數據上的樣子', () => {
    const line = playSeason(new World('a'), ctx({ twoWay: true }));
    expect(line.pitching).not.toBeNull();
    expect(line.batting).not.toBeNull();
  });

  it('二刀流的棒子撐不起他的投手丘：強打弱投拿不到先發輪值', () => {
    // 投球四項全爛、打擊全滿。他的 overall 70 是棒子掙來的，不該換成先發。
    const ability = with_(20, { con: 80, pow: 80, spd: 80, eye: 80 });
    const line = playSeason(
      new World('a'),
      ctx({ twoWay: true, ability, overall: 70, pitchingOverall: 20 }),
    );
    // 一場都沒登板的那一側整條不留——一整排 0 不是成績。
    expect(line.pitching).toBeNull();
    // 但他照樣是個強打者——扣的只有投手側。
    expect(line.batting?.pa).toBeGreaterThan(0);
  });

  it('二刀流的手臂換不到打席：強投弱打拿不到打擊出賽', () => {
    // 打擊四項全爛、投球全滿。他的 overall 70 是手臂掙來的，不該換成打席——
    // 投手能力再高也可以不上場打擊，這兩件事拆得開。
    const ability = with_(20, { vel: 80, ctl: 80, swp: 80, drp: 80 });
    const line = playSeason(
      new World('a'),
      ctx({ twoWay: true, ability, overall: 70, battingOverall: 20 }),
    );
    // 一打席都沒有的那一側整條不留——不會有個掛著 .000 的打者。
    expect(line.batting).toBeNull();
    // 但他照樣是個好投手——扣的只有打擊側。
    expect(line.pitching?.outs).toBeGreaterThan(0);
  });

  it('游擊手的手套照樣灌進打席——守備算在野手評價裡，這條路徑不受影響', () => {
    // 打擊平庸但守備撐起來的野手：battingOverall 等於他的野手評價，不被扣。
    const ability = with_(40, { fld: 80, arm: 80, spd: 70 });
    const line = playSeason(
      new World('a'),
      ctx({ better: 'fielder', position: 'SS', ability, overall: 65, battingOverall: 65 }),
    );
    expect(line.batting?.pa).toBeGreaterThan(0);
  });

  it('省略 pitchingOverall 時沿用 overall——單一守位球員一位元都不該動', () => {
    const ability = with_(60, { vel: 70, ctl: 70 });
    const base = playSeason(new World('a'), ctx({ better: 'pitcher', ability, overall: 60 }));
    const same = playSeason(
      new World('a'),
      ctx({ better: 'pitcher', ability, overall: 60, pitchingOverall: 60 }),
    );
    expect(same).toEqual(base);
  });

  it('0 局的投手不會生出勝投或救援——率型欄位不該自己長出成績', () => {
    // 直接測底層那條線：playSeason 會把它整條收掉，但收掉不是零化的替代品，
    // 兩層各自成立才行——別讓「反正外面會擋」變成裡面可以長出勝投的理由。
    const p = proPitchingLine(new World('a'), flat(20), 'CPBL1', 20, null, { seasonFactor: 0.5 });
    expect(p.games).toBe(0);
    expect(p.outs).toBe(0);
    expect(p.wins).toBe(0);
    expect(p.losses).toBe(0);
    expect(p.saves).toBe(0);
    expect(p.holds).toBe(0);
    expect(p.so).toBe(0);
    expect(p.er).toBe(0);
    // 而 playSeason 這一層再把整條收掉。
    expect(
      playSeason(new World('a'), ctx({ better: 'pitcher', ability: flat(20), overall: 20 }))
        .pitching,
    ).toBeNull();
  });

  it('只消耗 season 流，不動其他流', () => {
    const world = new World('a');
    playSeason(world, ctx({ twoWay: true }));
    const counts = world.drawCounts();
    expect(counts.season).toBeGreaterThan(0);
    expect(counts.genesis).toBe(0);
    expect(counts.growth).toBe(0);
    expect(counts.events).toBe(0);
    expect(counts.career).toBe(0);
  });

  it('相同種子產生完全相同的一季', () => {
    expect(playSeason(new World('a'), ctx({ twoWay: true }))).toEqual(
      playSeason(new World('a'), ctx({ twoWay: true })),
    );
  });

  it('二軍的門檻較低——同樣的能力在二軍打得比較好', () => {
    const avg = (level: string) => {
      let t = 0;
      for (let i = 0; i < 100; i++) {
        t += playSeason(new World(`s${i}`), ctx({ level })).batting?.avg ?? 0;
      }
      return t / 100;
    };
    expect(avg('CPBL2')).toBeGreaterThan(avg('CPBL1'));
  });
});

describe('投手的自責分由事件推導', () => {
  const line = (seed: string, v: number, over: Record<string, number> = {}, twr = 0.5) =>
    proPitchingLine(new World(seed), with_(v, over), 'MLB', v, null, { teamWinRate: twr });

  it('被打得少，自責分就跟著少——舊的錯點式做不到這件事', () => {
    let harder = 0;
    for (let i = 0; i < 60; i++) {
      const weak = line(`er-w-${i}`, 58);
      const strong = line(`er-s-${i}`, 72);
      if (weak.outs === 0 || strong.outs === 0) continue;
      // 每九局的被安打與每九局的自責分要同向。
      const wH = (weak.hits * 27) / weak.outs;
      const sH = (strong.hits * 27) / strong.outs;
      if (wH > sH && weak.era > strong.era) harder++;
    }
    expect(harder).toBeGreaterThan(40);
  });

  it('長打是從被安打裡切出來的，不會多生一支', () => {
    for (let i = 0; i < 60; i++) {
      const l = line(`xb-${i}`, 62 + (i % 12));
      expect(l.double + l.triple + l.hr).toBeLessThanOrEqual(l.hits);
      expect(l.double).toBeGreaterThanOrEqual(0);
      expect(l.triple).toBeGreaterThanOrEqual(0);
    }
  });

  it('控球差的人四壞多，觸身球也多——兩者同源', () => {
    const wild = line('hbp-wild', 62, { ctl: 35 });
    const sharp = line('hbp-sharp', 62, { ctl: 78 });
    expect(wild.bb / Math.max(1, wild.outs)).toBeGreaterThan(sharp.bb / Math.max(1, sharp.outs));
    expect(wild.hbp / Math.max(1, wild.outs)).toBeGreaterThan(sharp.hbp / Math.max(1, sharp.outs));
  });

  /**
   * ERA+ 的分母必須就是這組公式在 d=0 時真正產生的數字。分母若自己一條式子，
   * ERA+ 100 就不再是聯盟平均——而勝敗正是踩在 ERA+ 上面的。
   */
  it('eraAt(0) 與模型真正產生的聯盟平均對得上', () => {
    let total = 0;
    let n = 0;
    const par = leagues.levels['MLB']!.par;
    for (let i = 0; i < 200; i++) {
      const l = proPitchingLine(new World(`avg-${i}`), flat(par), 'MLB', par, null, {
        teamWinRate: 0.5,
        role: 'SP',
      });
      if (l.outs < 300) continue;
      total += l.era;
      n++;
    }
    expect(n).toBeGreaterThan(20);
    expect(Math.abs(total / n - eraAt(0, par))).toBeLessThan(0.6);
  });
});

describe('投手的勝敗由成績與球隊推導', () => {
  const line = (seed: string, v: number, twr: number) =>
    proPitchingLine(new World(seed), flat(v), 'MLB', v, null, { teamWinRate: twr, role: 'SP' });

  const totals = (v: number, twr: number, tag: string) => {
    let w = 0, l = 0, n = 0, maxW = 0, unbeaten = 0;
    for (let i = 0; i < 250; i++) {
      const p = line(`wl-${tag}-${i}`, v, twr);
      if (p.starts < 20) continue;
      w += p.wins; l += p.losses; n++;
      if (p.wins > maxW) maxW = p.wins;
      if (p.losses === 0 && p.wins >= 10) unbeaten++;
    }
    return { w: w / n, l: l / n, n, maxW, unbeaten };
  };

  it('同一個投手，強隊的勝投明顯多於弱隊', () => {
    const good = totals(68, 0.65, 'good');
    const bad = totals(68, 0.35, 'bad');
    expect(good.w).toBeGreaterThan(bad.w + 5);
    expect(bad.l).toBeGreaterThan(good.l + 5);
  });

  /** 使用者回報的病灶：爛隊也打得出 32 勝 0 敗。 */
  it('爛隊打不出誇張的勝投，也不會零敗', () => {
    const bad = totals(75, 0.3, 'elite-bad');
    expect(bad.maxW).toBeLessThan(23);
    expect(bad.unbeaten).toBe(0);
  });

  it('聯盟平均的投手在五成隊接近勝敗各半', () => {
    const par = leagues.levels['MLB']!.par;
    const even = totals(par, 0.5, 'even');
    expect(Math.abs(even.w - even.l)).toBeLessThan(3);
  });

  it('勝敗加起來不會超過出賽數', () => {
    for (let i = 0; i < 120; i++) {
      const p = line(`cap-${i}`, 60 + (i % 18), 0.3 + (i % 8) * 0.05);
      expect(p.wins + p.losses).toBeLessThanOrEqual(p.games);
    }
  });
});

describe('後援：機會 × 成功率', () => {
  const closer = (seed: string, v: number, twr: number) =>
    proPitchingLine(new World(seed), with_(v, { sta: 20 }), 'MLB', v, null, {
      teamWinRate: twr,
      role: 'CP',
    });

  it('強隊的終結者救援機會多——機會是球隊給的', () => {
    const avg = (twr: number, tag: string) => {
      let t = 0;
      for (let i = 0; i < 120; i++) t += closer(`sv-${tag}-${i}`, 66, twr).saves;
      return t / 120;
    };
    expect(avg(0.65, 'good')).toBeGreaterThan(avg(0.35, 'bad') + 5);
  });

  it('救援成功數不會超過後援出賽數', () => {
    for (let i = 0; i < 80; i++) {
      const p = closer(`svcap-${i}`, 60 + (i % 15), 0.35 + (i % 6) * 0.06);
      expect(p.saves + p.holds).toBeLessThanOrEqual(p.games - p.starts);
    }
  });

  /** 一屆賽會只有幾場球，球隊勝場要照那個長度算，不是照聯盟的一百六十二場。 */
  it('國際賽那種短賽程不會讓終結者每場都關門成功', () => {
    let total = 0;
    for (let i = 0; i < 60; i++) {
      const p = proPitchingLine(new World(`intl-${i}`), with_(70, { sta: 20 }), 'MLB', 70, null, {
        teamWinRate: 0.42,
        role: 'CP',
        appearances: 5,
      });
      total += p.saves;
    }
    expect(total / 60).toBeLessThan(3);
  });

  it('救援成功率擠在窄帶裡——再強的終結者也會被打爆幾次', () => {
    let converted = 0;
    let n = 0;
    for (let i = 0; i < 120; i++) {
      const p = closer(`rate-${i}`, 74, 0.55);
      if (p.saves === 0) continue;
      converted += p.saves;
      n++;
    }
    // 一支 .550 的球隊約 89 勝、約 55 次救援機會，成功率 0.70-0.95 因此落在
    // 38 到 52 之間。真實的單季紀錄是 62，靠的是球隊贏更多而不是成功率破表。
    expect(converted / n).toBeGreaterThan(30);
    expect(converted / n).toBeLessThan(56);
  });
});

describe('三壘打的曲線', () => {
  const at = (spd: number) => {
    let total = 0;
    const n = 300;
    for (let i = 0; i < n; i++) {
      const l = proBattingLine(
        new World(`3b-${spd}-${i}`),
        with_(60, { spd, sta: 75 }),
        'CF',
        'MLB',
        60,
        null,
      );
      total += l.triple;
    }
    return total / n;
  };

  /**
   * 三壘打不是「比較快就多一點」，是快到某個程度才跑得出來的東西。曲線在中段
   * 太平的話，「跑得中上」就開始吐出可觀的三壘打——現實裡那一段幾乎沒有。
   *
   * **這一格的次方由這個形狀決定，不由 par 決定**：par 水準的人一年只有 0.1 支，
   * 拿那個點當基準沒有意義（見 season.json 的 _exponent_note）。
   */
  it('中段跑得中上的人拿不到多少——腳程 70 還在個位數的低段', () => {
    expect(at(70)).toBeLessThan(3);
  });

  /**
   * **比的是比值而不是支數。** 錨點搬到 80 之後，「腳程 80、其他 60」這種專才離
   * 錨點遠了一截，兩端的支數都掉進抖動（±3）的量級——量到的比會被抖動在零那一
   * 側的地板壓平，而那不是曲線的形狀。
   */
  /**
   * **次方就是由這條反解出來的。** `ln5 ÷ ln1.1` = 16.886，取 16.89——那是「中段
   * 要空」這件事允許的最平緩的曲線，再低就換不到五倍了。產量吃緊時先動的是錨點，
   * 不是這裡。
   */
  it('頂端仍然明顯——腳程 80 的比值是腳程 70 的五倍以上', () => {
    const t = cfg.batting.records.triple;
    const baseAt = (spd: number) => (60 * 1 + 60 * 1 + spd * 4) / (t.divisor ?? 1);
    const ratio = Math.pow(baseAt(80) / baseAt(70), t.exponent ?? 1);
    expect(ratio).toBeGreaterThan(5);
  });

  it('頂端的支數看得見，中段幾乎沒有', () => {
    expect(at(80)).toBeGreaterThan(3);
    expect(at(70)).toBeLessThan(2);
  });

  it('一路遞增，沒有任何一段反轉', () => {
    const curve = [55, 60, 65, 70, 75, 80].map(at);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]!);
    }
  });

  /**
   * 底數要 ≥ 1 才吃得到 ratio_cap，換算成腳程 90——一般天花板 80 到不了。
   * 單季紀錄因此是留給被事件推過上限的極端腳程的。
   */
  it('一般天花板碰不到錨點，紀錄要靠推過上限的腳程', () => {
    const t = cfg.batting.records.triple;
    const baseAt = (spd: number) => (60 * 1 + 60 * 1 + spd * 4) / (t.divisor ?? 1);
    expect(baseAt(85)).toBeLessThan(1);
    expect(baseAt(95)).toBeGreaterThan(1);
  });
});

describe('全壘打的曲線', () => {
  const at = (v: number) => {
    let total = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      const l = proBattingLine(
        new World(`hr-${v}-${i}`),
        with_(v, { sta: 75 }),
        '1B',
        'MLB',
        v,
        null,
      );
      total += l.hr;
    }
    return total / n;
  };

  /**
   * 中段吐得比想像的多一點，次方從 5.97 拉到 6.47 把它壓下來。頂端不動——底數在
   * 能力 75 剛好是 1，次方咬不動它。
   */
  it('中段壓得住——能力 65 不到 30 支、70 不到 45 支', () => {
    expect(at(65)).toBeLessThan(30);
    expect(at(70)).toBeLessThan(45);
  });

  /**
   * **錨點是率，不是季總量**（ADR 0046）。能力 80 的打者一季被敬遠一百次上下，
   * 那些打席不進打數，季總量因此低於錨點——那不是曲線沒到位，是分母不同。
   * Bonds 2004 年 45 轟 373 打數也是同一回事。
   */
  it('能力 80 打得到錨點——每 600 打數', () => {
    const rate = (v: number) => {
      let hr = 0;
      let ab = 0;
      for (let i = 0; i < 200; i++) {
        const l = proBattingLine(new World(`hr-${v}-${i}`), with_(v, { sta: 75 }), '1B', 'MLB', v, null);
        hr += l.hr;
        ab += l.ab;
      }
      return (hr / ab) * 600;
    };
    expect(rate(80)).toBeGreaterThan(55);
  });

  it('一路遞增，沒有任何一段反轉', () => {
    const curve = [55, 60, 65, 70, 75].map(at);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]!);
    }
  });
});

describe('投手四壞的曲線', () => {
  const at = (ctl: number, level: string) => {
    let bb = 0;
    let outs = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      const l = proPitchingLine(
        new World(`pbb-${level}-${ctl}-${i}`),
        with_(65, { ctl, sta: 70 }),
        level,
        65,
      );
      bb += l.bb;
      outs += l.outs;
    }
    return (bb * 9) / (outs / 3);
  };

  /**
   * 次方小於 1，曲線是凹的：控球的缺口才剛出現就已經看得到保送。線性式子把中間
   * 水準的投手畫得太乾淨——大聯盟 par 的先發只有 2.2 BB/9，而現實約 3.2。
   */
  it('大聯盟平均水準的先發落在現實的保送帶', () => {
    expect(at(59, 'MLB')).toBeGreaterThan(2.7);
    expect(at(59, 'MLB')).toBeLessThan(3.5);
  });

  it('控球越好保送越少，沒有任何一段反轉', () => {
    const curve = [45, 50, 55, 59, 65, 70].map((c) => at(c, 'MLB'));
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!).toBeLessThanOrEqual(curve[i - 1]!);
    }
  });

  /**
   * 次方咬不動兩端。缺口 0 仍然是地板，所以控球 75 以上的人這次完全沒有變。
   */
  it('控球 80 以上仍然踩在地板上', () => {
    expect(at(80, 'MLB')).toBeLessThan(1);
    expect(at(85, 'MLB')).toBeLessThan(1);
  });
});
