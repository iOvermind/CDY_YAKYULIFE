import { describe, expect, it } from 'vitest';
// @ts-expect-error 腳本是純 JS（.mjs），沒有型別宣告。
import { applyRelease, planRelease } from './release.mjs';

const doc = (unreleased: string) => `# 變更紀錄

## [Unreleased]
${unreleased}
## [0.4.0] - 2026-09-25

### Added (新增)

- 舊的條目。
`;

describe('planRelease：看 [Unreleased] 的類別決定跳哪一位（VERSION_RULES §4.1）', () => {
  it('沒有任何條目就不發版', () => {
    expect(planRelease(doc('\n'), '0.4.0')).toBeNull();
    expect(planRelease(doc('\n### Added (新增)\n\n'), '0.4.0')).toBeNull();
  });

  it('只有修復或安全：末位', () => {
    expect(planRelease(doc('\n### Fixed (修復)\n\n- 修了一個錯。\n'), '0.4.0')).toEqual({ bump: 'patch', next: '0.4.1' });
    expect(planRelease(doc('\n### Security (安全)\n\n- 補洞。\n'), '1.2.3')).toEqual({ bump: 'patch', next: '1.2.4' });
  });

  it('新增、變更、即將移除：中間，末位歸零；取最高的那一位', () => {
    const md = doc('\n### Added (新增)\n\n- 新功能。\n\n### Fixed (修復)\n\n- 修正。\n');
    expect(planRelease(md, '0.4.3')).toEqual({ bump: 'minor', next: '0.5.0' });
    expect(planRelease(doc('\n### Changed (變更)\n\n- 改了。\n'), '0.4.0')).toEqual({ bump: 'minor', next: '0.5.0' });
    expect(planRelease(doc('\n### Deprecated (即將移除)\n\n- 快拿掉了。\n'), '0.4.0')).toEqual({ bump: 'minor', next: '0.5.0' });
  });

  it('移除或標了破壞性變更：最高位——0.x 也照字面跳到 1.0.0', () => {
    expect(planRelease(doc('\n### Removed (移除)\n\n- 拿掉了。\n'), '0.4.0')).toEqual({ bump: 'major', next: '1.0.0' });
    const breaking = doc('\n### Changed (變更)\n\n- **[破壞性變更]** 存檔清空。\n');
    expect(planRelease(breaking, '1.2.3')).toEqual({ bump: 'major', next: '2.0.0' });
  });
});

describe('applyRelease', () => {
  it('[Unreleased] 改成版本號與日期，上面留一個空的 [Unreleased]', () => {
    const md = doc('\n### Fixed (修復)\n\n- 修了一個錯。\n');
    const out = applyRelease(md, '0.4.1', '2026-09-27');
    expect(out).toContain('## [Unreleased]\n\n## [0.4.1] - 2026-09-27\n\n### Fixed (修復)\n\n- 修了一個錯。\n');
    // 其他版本原封不動。
    expect(out).toContain('## [0.4.0] - 2026-09-25');
    expect(out.match(/## \[Unreleased\]/g)).toHaveLength(1);
  });

  it('找不到 [Unreleased] 就拒絕，不要默默產出一份沒改的檔案', () => {
    expect(() => applyRelease('# 變更紀錄\n\n## [0.4.0] - 2026-09-25\n', '0.4.1', '2026-09-27')).toThrow();
  });
});
