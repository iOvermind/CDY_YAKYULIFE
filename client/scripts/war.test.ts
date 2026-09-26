/**
 * WAR 的量級校準（2026-09-27）。
 *
 * WAR 用自己的替代水準：評價分的 p₀ 乘上 `season.json` 的 `war_replacement_scale`
 * （評價分不看那個係數）。係數是對著現實的長青球星校準的——WS ÷ WAR 投手約 3.5
 * （Clemens 3.1、Maddux 3.8、Cy Young 3.9）、野手約 4.5（魯斯 4.1、Aaron 4.5、
 * 華格納 5.0）。這支測試守住那兩個比值，成績模型或 p₀ 一動就會知道要重解係數：
 *
 *     f = (WS − 3 × WS ÷ 目標比值) ÷ Σ(p₀ × 責任額)，取職業 12 季以上、WS 前三成的中位數
 */
import { describe, expect, it } from 'vitest';
import { playCareer } from './harness.ts';

describe('WAR 的量級', () => {
  it('長生涯的 WS ÷ WAR 落在現實的範圍：投手 3–4、野手 4–5', () => {
    const ratios: Record<'P' | 'B', number[]> = { P: [], B: [] };
    for (let i = 0; i < 200; i++) {
      const pos = (['SS', 'CF', 'C', '1B', 'P'] as const)[i % 5]!;
      const summary = playCareer(`war-cal-${i}`, pos).summary;
      const seasons = (summary?.seasons ?? []).filter((s) => s.top !== null);
      if (summary === null || seasons.length < 12) continue;
      let ws = 0;
      let war = 0;
      for (const l of summary.leagues) {
        const side = pos === 'P' ? ['pitching'] : ['batting', 'fielding'];
        for (const part of side as ('batting' | 'pitching' | 'fielding')[]) {
          ws += l.sharesByPart[part].win;
          war += l.war[part];
        }
      }
      if (war > 0) ratios[pos === 'P' ? 'P' : 'B'].push(ws / war);
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    expect(ratios.P.length).toBeGreaterThan(5);
    expect(ratios.B.length).toBeGreaterThan(5);
    expect(median(ratios.P)).toBeGreaterThan(3);
    expect(median(ratios.P)).toBeLessThan(4);
    expect(median(ratios.B)).toBeGreaterThan(4);
    expect(median(ratios.B)).toBeLessThan(5);
  }, 600000);
});
