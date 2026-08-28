/**
 * 設定覆蓋層。
 *
 * 天賦不寫死效果，而是宣告「改哪一個設定、怎麼改、夾在哪」，由這一層在一局開始
 * 時套上、結束時還原。**新增一個天賦因此只是新增一筆 JSON**，不必改程式——與這個
 * 專案「所有平衡數字都在 JSON」的既有原則一致。見 ADR 0007。
 *
 * ## 為什麼是就地修改
 *
 * 引擎各模組在載入時就捕捉了設定物件的參考（`const cfg = season.pitching`），
 * 要改成傳遞式設定等於重寫每一個模組。就地修改換到的是零重構。
 *
 * ## 代價：這是全域可變狀態
 *
 * **同一時間只能有一局套著覆蓋。** 瀏覽器本來就只跑一局；伺服器端的重跑驗證必須
 * 序列化，或隔離到獨立行程。日後有人要加並行處理時，這裡是第一個會爆的地方。
 *
 * 天賦與參數編輯介面共用這一層，差別只在來源：天賦是官方的覆蓋，照常計分；
 * 編輯器是玩家自訂的，該局標記為自訂規則局。
 */

import {
  abilities,
  amateur,
  awards,
  events,
  hallOfFame,
  injury,
  leagues,
  love,
  positions,
  season,
  talents as talentData,
  traits,
} from '../data/index.ts';

/**
 * 一條覆蓋：改哪一個設定、怎麼改、夾在哪。
 *
 * `mul` 存在的理由見 ADR 0033：機率類的設定只接受乘算。加算會疊出破表的數字
 * （「今晚打老虎」再加一次百分比就衝破上限），乘算則天然是比例的，疊幾層都還在
 * 同一個尺度上。
 */
export interface Effect {
  readonly path: string;
  readonly op: 'add' | 'set' | 'mul';
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
}

/** 每個玩家買到的天賦與層級。層級從 1 起算，0 或缺席表示沒買。 */
export type TalentLevels = Readonly<Record<string, number>>;

/**
 * 路徑的第一段是規則資料的檔名。
 *
 * 刻意列成一張明表而不是動態查找——路徑是資料寫的，能改到什麼必須是程式決定的。
 */
const ROOTS: Readonly<Record<string, unknown>> = {
  abilities,
  amateur,
  awards,
  events,
  hall_of_fame: hallOfFame,
  injury,
  leagues,
  love,
  positions,
  season,
  traits,
};

/** 解析一條路徑，回傳「持有它的物件」與「鍵」。解不到就回 null。 */
export function resolvePath(path: string): { container: Record<string, number>; key: string } | null {
  const parts = path.split('.');
  const rootName = parts.shift();
  const leaf = parts.pop();
  if (rootName === undefined || leaf === undefined) return null;

  let node: unknown = ROOTS[rootName];
  for (const part of parts) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[part];
  }
  if (node === null || typeof node !== 'object') return null;
  const container = node as Record<string, unknown>;
  if (typeof container[leaf] !== 'number') return null;
  return { container: container as Record<string, number>, key: leaf };
}

/** 這個天賦這一級的效果。層級不存在就回空陣列。 */
export function effectsOf(talentId: string, level: number): readonly Effect[] {
  const talent = talentData.talents.find((t) => t.id === talentId);
  if (talent === undefined || level <= 0) return [];
  return (talent.levels[level - 1]?.effects ?? []) as readonly Effect[];
}

/** 買到這一級為止總共要花多少 AP。退款時退的也是這個數字。 */
export function costOf(talentId: string, level: number): number {
  const talent = talentData.talents.find((t) => t.id === talentId);
  if (talent === undefined) return 0;
  return talent.levels.slice(0, Math.max(0, level)).reduce((sum, l) => sum + l.cost, 0);
}

/** 這個天賦最多幾級。 */
export function maxLevelOf(talentId: string): number {
  return talentData.talents.find((t) => t.id === talentId)?.levels.length ?? 0;
}

/**
 * 套上一組天賦，回傳還原用的函式。
 *
 * **一定要成對呼叫。** 沒還原的話下一局會帶著上一局的加成——那是這一層最容易出的
 * 錯，因此還原函式是回傳值而不是另一個要記得呼叫的 API。
 *
 * 走訪順序照 `talents.json` 的宣告順序，同一個路徑被多個天賦改到時結果才穩定。
 */
export function applyTalents(levels: TalentLevels): () => void {
  const restore: { container: Record<string, number>; key: string; value: number }[] = [];

  for (const talent of talentData.talents) {
    const level = levels[talent.id] ?? 0;
    for (const effect of effectsOf(talent.id, level)) {
      const target = resolvePath(effect.path);
      // 路徑解不到就跳過——護欄測試會在建置前抓到，執行時不該讓一個錯字弄壞一局。
      if (target === null) continue;

      const before = target.container[target.key] ?? 0;
      restore.push({ container: target.container, key: target.key, value: before });

      let next: number;
      if (effect.op === 'set') next = effect.value;
      else if (effect.op === 'mul') next = before * effect.value;
      else next = before + effect.value;
      if (effect.min !== undefined) next = Math.max(effect.min, next);
      if (effect.max !== undefined) next = Math.min(effect.max, next);
      target.container[target.key] = next;
    }
  }

  // 倒著還原：同一個路徑被改過兩次時，才會回到最初的值。
  return () => {
    for (let i = restore.length - 1; i >= 0; i--) {
      const entry = restore[i];
      if (entry !== undefined) entry.container[entry.key] = entry.value;
    }
  };
}
