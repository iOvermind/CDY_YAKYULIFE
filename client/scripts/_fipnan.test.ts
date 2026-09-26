import { it } from 'vitest';
import { playCareer } from './harness.ts';
import { fip } from '../src/engine/season.ts';
it('find NaN', () => {
  let found = 0;
  for (let i = 0; i < 80 && found < 5; i++) {
    const g = playCareer(`fip-${i}`, 'P');
    const s = g.summary!;
    for (const l of s.leagues) {
      const v = l.pitching === null ? null : fip(l.pitching);
      if (v !== null && Number.isNaN(v)) {
        found++;
        const bad = s.seasons.filter((x) => x.pitching !== null && x.org === l.org && (x.pitching.hr === undefined || x.pitching.hbp === undefined || Number.isNaN(x.pitching.hr) || Number.isNaN(x.pitching.hbp)));
        console.log(`fip-${i} ${l.orgName}: 缺值的季 ${bad.length}/${s.seasons.filter((x) => x.org === l.org).length}`, JSON.stringify(bad.slice(0, 2).map((x) => ({ y: x.year, lvl: x.level, top: x.top, role: x.pitcherRole, hr: x.pitching!.hr, hbp: x.pitching!.hbp, keys: Object.keys(x.pitching!).length }))));
      }
    }
  }
  console.log('found', found);
}, 300000);
