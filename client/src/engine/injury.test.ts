import { describe, expect, it } from 'vitest';
import { injury as cfg } from '../data/index.ts';
import { injuryChance, rollAmateurInjury, rollInjury, unlocksGlass } from './injury.ts';
import { World } from './rng.ts';

const none = new Set<string>();

describe('受傷機率', () => {
  it('年紀越大越容易受傷', () => {
    const young = injuryChance({ age: 25, traits: none });
    const mid = injuryChance({ age: 33, traits: none });
    const old = injuryChance({ age: 36, traits: none });
    expect(mid).toBeGreaterThan(young);
    expect(old).toBeGreaterThan(mid);
  });

  it('逃學威龍只在 25 歲之前有效', () => {
    const t = new Set(['academy']);
    const before = cfg.chance.traits.academy.before_age - 1;
    expect(injuryChance({ age: before, traits: t })).toBeLessThan(
      injuryChance({ age: before, traits: none }),
    );
    const after = cfg.chance.traits.academy.before_age;
    expect(injuryChance({ age: after, traits: t })).toBe(injuryChance({ age: after, traits: none }));
  });

  it('魔鬼筋肉人是上限、帕瓦諾是下限', () => {
    expect(injuryChance({ age: 38, traits: new Set(['iron']) })).toBe(cfg.chance.traits.iron.cap);
    expect(injuryChance({ age: 22, traits: new Set(['glass']) })).toBe(
      cfg.chance.traits.glass.floor,
    );
  });

  it('兩個極端體質並存時取固定值——說誰壓過誰都不對', () => {
    expect(injuryChance({ age: 30, traits: new Set(['iron', 'glass']) })).toBe(
      cfg.chance.traits.both.value,
    );
  });

  it('事件卡自找的風險不受魔鬼筋肉人上限保護', () => {
    const iron = new Set(['iron']);
    const plain = injuryChance({ age: 25, traits: iron });
    expect(injuryChance({ age: 25, traits: iron, extraRisk: 20 })).toBe(plain + 20);
  });

  it('省略體力時這一項不計——舊呼叫端的行為不變', () => {
    expect(injuryChance({ age: 25, traits: none, stamina: undefined })).toBe(
      injuryChance({ age: 25, traits: none }),
    );
  });

  it('體力 40 以下加受傷率——那一段不再少打，改成容易壞', () => {
    const at40 = injuryChance({ age: 25, traits: none, stamina: 40 });
    expect(injuryChance({ age: 25, traits: none, stamina: 30 })).toBeGreaterThan(at40);
    expect(injuryChance({ age: 25, traits: none, stamina: 20 })).toBeGreaterThan(
      injuryChance({ age: 25, traits: none, stamina: 30 }),
    );
  });

  it('打滿標準以下、40 以上沒有修正——那一段的回報全在出賽場數上', () => {
    const plain = injuryChance({ age: 25, traits: none });
    for (const sta of [40, 48, 55]) {
      expect(injuryChance({ age: 25, traits: none, stamina: sta, position: 'DH' })).toBe(plain);
    }
  });

  it('超過打滿標準的體力折成免傷——體力從來不是白練的', () => {
    const plain = injuryChance({ age: 25, traits: none });
    expect(injuryChance({ age: 25, traits: none, stamina: 64, position: 'DH' })).toBeLessThan(plain);
  });

  it('免傷的零點是守位自己的——同樣 sta 60，DH 換得到、游擊換不到', () => {
    const dh = injuryChance({ age: 25, traits: none, stamina: 60, position: 'DH' });
    const ss = injuryChance({ age: 25, traits: none, stamina: 60, position: 'SS' });
    expect(dh).toBeLessThan(ss);
    expect(ss).toBe(injuryChance({ age: 25, traits: none }));
  });

  it('捕手的零點釘在 70，不是反解出來的 76.5', () => {
    const plain = injuryChance({ age: 25, traits: none });
    expect(injuryChance({ age: 25, traits: none, stamina: 70, position: 'C' })).toBe(plain);
    expect(injuryChance({ age: 25, traits: none, stamina: 76, position: 'C' })).toBeLessThan(plain);
  });

  it('短賽季的零點跟著降——中職的 DH 比大聯盟的早換到免傷', () => {
    const short = injuryChance({ age: 25, traits: none, stamina: 55, position: 'DH', leagueGames: 120 });
    const long = injuryChance({ age: 25, traits: none, stamina: 55, position: 'DH', leagueGames: 162 });
    expect(short).toBeLessThan(long);
  });

  // 體力可以買到魔鬼筋肉人給的東西，不能買到比它更多的——否則特性就不是特性了。
  it('體力折滿正好落在魔鬼筋肉人的上限上，不越過它', () => {
    const maxed = injuryChance({ age: 25, traits: none, stamina: 99, position: 'DH' });
    expect(maxed).toBe(cfg.chance.traits.iron.cap);
    expect(maxed).toBe(cfg.chance.base - cfg.chance.stamina.max_cut);
  });

  it('折扣有上限——再練下去不會歸零', () => {
    expect(injuryChance({ age: 25, traits: none, stamina: 200, position: 'DH' })).toBe(
      injuryChance({ age: 25, traits: none, stamina: 99, position: 'DH' }),
    );
  });

  it('印在卡片上的數字是整數', () => {
    for (const sta of [37, 61, 63, 71, 73]) {
      for (const p of ['DH', 'SS', 'C']) {
        expect(injuryChance({ age: 25, traits: none, stamina: sta, position: p })).toBe(
          Math.round(injuryChance({ age: 25, traits: none, stamina: sta, position: p })),
        );
      }
    }
  });

  it('體力算在體質的上下限裡面，不像事件卡那樣穿透魔鬼筋肉人', () => {
    const iron = new Set(['iron']);
    expect(injuryChance({ age: 38, traits: iron, stamina: 20 })).toBe(cfg.chance.traits.iron.cap);
  });

  it('永遠在上下限之內', () => {
    expect(injuryChance({ age: 44, traits: new Set(['glass']), extraRisk: 300 })).toBe(
      cfg.chance.clamp.max,
    );
    expect(injuryChance({ age: 20, traits: new Set(['iron']), extraRisk: -100 })).toBe(
      cfg.chance.clamp.min,
    );
  });
});

describe('傷勢', () => {
  it('健康的一年出賽係數是 1，而且不留損失', () => {
    const world = new World('healthy');
    // 魔鬼筋肉人 + 年輕 = 機率壓到很低，多跑幾次一定抽得到健康的年份。
    let healthy = 0;
    for (let i = 0; i < 200; i++) {
      const r = rollInjury(world, { age: 22, traits: new Set(['iron']) });
      if (r.kind !== 'none') continue;
      healthy++;
      expect(r.seasonFactor).toBe(1);
      expect(r.loss.scope).toBe('none');
      expect(r.rehabNextYear).toBe(false);
    }
    expect(healthy).toBeGreaterThan(0);
  });

  it('小傷砍出賽、大傷是賽季報銷，兩者的係數落在設定區間內', () => {
    const world = new World('hurt');
    let minor = 0;
    let major = 0;
    for (let i = 0; i < 400; i++) {
      const r = rollInjury(world, { age: 36, traits: new Set(['glass']) });
      if (r.kind === 'minor') {
        minor++;
        const lost = Math.round((1 - r.seasonFactor) * 100);
        expect(lost).toBeGreaterThanOrEqual(cfg.severity.minor.games_lost_percent.min);
        expect(lost).toBeLessThanOrEqual(cfg.severity.minor.games_lost_percent.max);
      }
      if (r.kind === 'major') {
        major++;
        const played = Math.round(r.seasonFactor * 100);
        expect(played).toBeGreaterThanOrEqual(cfg.severity.major.season_played_percent.min);
        expect(played).toBeLessThanOrEqual(cfg.severity.major.season_played_percent.max);
        expect(r.loss).toEqual({ scope: 'all', points: cfg.severity.major.ability_loss.points });
      }
    }
    expect(minor).toBeGreaterThan(0);
    expect(major).toBeGreaterThan(0);
  });

  // 抽取次數與是否受傷無關，否則同一個種子會因為某年差一分而讓整條子序列偏移。
  it('健康的一年與受傷的一年消耗一樣多亂數', () => {
    const a = new World('drift');
    const b = new World('drift');
    rollInjury(a, { age: 22, traits: new Set(['iron']) }); // 幾乎不會受傷
    rollInjury(b, { age: 40, traits: new Set(['glass']) }); // 幾乎一定受傷
    expect(a.stream('health').next()).toBe(b.stream('health').next());
  });

  it('只走 health 子序列', () => {
    const world = new World('stream');
    rollInjury(world, { age: 30, traits: none });
    const counts = world.drawCounts();
    expect(counts.health).toBeGreaterThan(0);
    expect(counts.season).toBe(0);
    expect(counts.career).toBe(0);
    expect(counts.growth).toBe(0);
  });
});

describe('帕瓦諾的解鎖', () => {
  const g = cfg.glass_unlock;

  it('生涯第二次大傷才貼標籤', () => {
    expect(unlocksGlass({ majorInjuries: g.major_injuries - 1, age: 25, traits: none })).toBe(false);
    expect(unlocksGlass({ majorInjuries: g.major_injuries, age: 25, traits: none })).toBe(true);
  });

  it('32 歲以後的大傷是歲月的損耗，不是體質問題', () => {
    expect(unlocksGlass({ majorInjuries: 5, age: g.before_age, traits: none })).toBe(false);
  });

  it('已經是帕瓦諾就不再重複貼', () => {
    expect(unlocksGlass({ majorInjuries: 5, age: 25, traits: new Set([g.trait]) })).toBe(false);
  });
});

describe('養成期的傷病', () => {
  it('不做大傷，也不留後遺症——那個階段沒有合約可以承接後果', () => {
    const world = new World('amateur');
    let hurt = 0;
    for (let i = 0; i < 400; i++) {
      const r = rollAmateurInjury(world, 16);
      if (r.kind === 'none') continue;
      hurt++;
      expect(r.kind).toBe('minor');
      expect(r.loss.scope).toBe('none');
      expect(r.rehabNextYear).toBe(false);
      expect(r.seasonFactor).toBeLessThan(1);
      expect(r.seasonFactor).toBeGreaterThan(0);
    }
    expect(hurt).toBeGreaterThan(0);
  });
});
