import { describe, expect, it } from 'vitest';
import { season as cfg } from '../data/index.ts';
import type { BattingLine, PitchingLine } from './amateurStats.ts';
import {
  amateurBaseline,
  battingWinShares,
  eraPlus,
  opsPlus,
  pitchingWinShares,
  proBaseline,
  runsCreated,
} from './metrics.ts';

const base = proBaseline('CPBL1');

const bat = (over: Partial<BattingLine> = {}): BattingLine => ({
  games: 120, pa: 500, ab: 450, runs: 60, hits: 120, double: 24, triple: 3, hr: 12,
  rbi: 60, bb: 45, ibb: 5, so: 80, sb: 8, cs: 3,
  avg: 120 / 450, obp: 170 / 500, slg: (81 + 48 + 9 + 48) / 450,
  ...over,
});

const pit = (over: Partial<PitchingLine> = {}): PitchingLine => ({
  games: 25, starts: 25, wins: 10, losses: 8, saves: 0, ip: 150, hits: 145,
  runs: 70, er: 65, bb: 45, so: 120, era: 3.9,
  ...over,
});

describe('baseline', () => {
  it('職業的基準線是算出來的，不是抄的——上壘率落在合理範圍', () => {
    expect(base.obp).toBeGreaterThan(0.28);
    expect(base.obp).toBeLessThan(0.38);
  });

  it('長打率高於打擊率', () => {
    expect(base.slg).toBeGreaterThan(base.obp - 0.1);
  });

  it('防禦率就是設定裡的 base', () => {
    expect(base.era).toBe(cfg.pitching.era.base);
  });

  it('養成期與職業的基準線不同——門檻本來就不一樣', () => {
    expect(amateurBaseline().era).not.toBe(base.era);
  });

  it('每打席創造的分數是正的', () => {
    expect(base.runsCreatedPerPa).toBeGreaterThan(0);
  });
});

describe('runsCreated', () => {
  it('沒有打數就沒有得分創造', () => {
    expect(runsCreated(bat({ ab: 0, bb: 0, ibb: 0 }))).toBe(0);
  });

  it('全壘打比一壘安打創造更多分', () => {
    const single = bat({ hits: 120, double: 0, triple: 0, hr: 0 });
    const power = bat({ hits: 120, double: 0, triple: 0, hr: 40 });
    expect(runsCreated(power)).toBeGreaterThan(runsCreated(single));
  });

  it('保送也創造分數', () => {
    expect(runsCreated(bat({ bb: 80 }))).toBeGreaterThan(runsCreated(bat({ bb: 20 })));
  });
});

describe('eraPlus', () => {
  it('防禦率等於聯盟平均時是 100', () => {
    expect(eraPlus(pit({ era: base.era }), base)).toBe(100);
  });

  it('防禦率越低 ERA+ 越高', () => {
    expect(eraPlus(pit({ era: 2.0 }), base)!).toBeGreaterThan(
      eraPlus(pit({ era: 5.0 }), base)!,
    );
  });

  it('防禦率是聯盟一半時大約 200', () => {
    expect(eraPlus(pit({ era: base.era / 2 }), base)).toBe(200);
  });

  it('沒有投球局數時回傳 null，不是 0——0 會被誤讀成差到極點', () => {
    expect(eraPlus(pit({ ip: 0 }), base)).toBeNull();
  });
});

describe('opsPlus', () => {
  it('上壘率與長打率都等於聯盟平均時是 100', () => {
    expect(opsPlus(bat({ obp: base.obp, slg: base.slg }), base)).toBe(100);
  });

  it('打得越好 OPS+ 越高', () => {
    expect(opsPlus(bat({ obp: 0.42, slg: 0.55 }), base)!).toBeGreaterThan(
      opsPlus(bat({ obp: 0.29, slg: 0.33 }), base)!,
    );
  });

  it('上壘與長打各自相對聯盟——上壘型打者不會被低估', () => {
    // 兩人的 OPS 相同，但上壘型的 OBP 高。分項相除時兩者不該相差太遠。
    const onBase = opsPlus(bat({ obp: base.obp + 0.06, slg: base.slg }), base)!;
    const slugger = opsPlus(bat({ obp: base.obp, slg: base.slg + 0.06 }), base)!;
    expect(onBase).toBeGreaterThan(slugger);
  });

  it('沒有打席時回傳 null', () => {
    expect(opsPlus(bat({ pa: 0 }), base)).toBeNull();
  });
});

describe('winShares', () => {
  it('聯盟平均的打者拿得到正的 WS——替代水準低於平均', () => {
    expect(battingWinShares(bat(), base)).toBeGreaterThan(0);
  });

  it('打得越好 WS 越高', () => {
    expect(battingWinShares(bat({ hits: 180, hr: 35 }), base)).toBeGreaterThan(
      battingWinShares(bat({ hits: 80, hr: 2 }), base),
    );
  });

  it('沒有出賽就沒有 WS', () => {
    expect(battingWinShares(bat({ pa: 0, ab: 0, hits: 0, bb: 0, ibb: 0 }), base)).toBe(0);
  });

  it('WS 不會是負的——貢獻低於替代水準就是 0', () => {
    expect(battingWinShares(bat({ hits: 10, double: 0, triple: 0, hr: 0, bb: 0, ibb: 0 }), base)).toBe(0);
    expect(pitchingWinShares(pit({ era: 12 }), base)).toBe(0);
  });

  it('投得越好 WS 越高', () => {
    expect(pitchingWinShares(pit({ era: 2.2 }), base)).toBeGreaterThan(
      pitchingWinShares(pit({ era: 4.5 }), base),
    );
  });

  it('同樣的防禦率，投得越多 WS 越高', () => {
    expect(pitchingWinShares(pit({ ip: 200 }), base)).toBeGreaterThan(
      pitchingWinShares(pit({ ip: 60 }), base),
    );
  });

  it('全職主力的 WS 落在真實 WS 的數量級——大約個位數到二十幾', () => {
    const star = battingWinShares(bat({ hits: 175, double: 35, hr: 30, bb: 70, obp: 0.4 }), base);
    expect(star).toBeGreaterThan(5);
    expect(star).toBeLessThan(45);
  });
});
