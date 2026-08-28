/**
 * 榮譽與獎項的名稱組法。
 *
 * **一個規則：組出來的名字，各段之間一律留一個半形空白。** 「中華隊WBSC U-15
 * 世界盃冠軍」讀不出斷句，「中職MVP」把中文與英文黏成一團；補空白這件事只要有
 * 例外就一定會有人踩到例外。所以不分中英、不看標點，一律隔開。
 *
 * 名字在**源頭**組好——存進 `honors` 的字串就是要顯示的字串。顯示層不再補空白，
 * 因為那樣同一個字串會有兩種樣子，而成就是拿字串當識別的（見 achievements.ts）。
 */

/** 把幾段名字接成一個顯示字串。空的段落直接略過。 */
export function joinName(...parts: (string | number | null | undefined)[]): string {
  return parts
    .map((p) => (p === null || p === undefined ? '' : String(p).trim()))
    .filter((p) => p !== '')
    .join(' ');
}
