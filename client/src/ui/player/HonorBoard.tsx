import type { AwardRecord } from '../../engine/awards.ts';
import type { CareerSummary } from '../../engine/career.ts';
import type { PlayerState } from '../../engine/game.ts';
import { honorGroups } from './profile.ts';

/**
 * 榮譽榜。**只在生涯結束後出現，而且含養成期。**
 *
 * 生涯進行中，左側記分板的「榮譽 N」那盞燈就夠了——那時玩家關心的是「我拿過
 * 幾項」，攤開一整面清單只會把版面吃掉。結算之後相反：那串東西就是他的生涯
 * 軌跡，該攤開來看。
 */
export function HonorBoard({
  awards,
  honors,
  summary,
  love,
}: {
  awards: readonly AwardRecord[];
  honors: readonly string[];
  summary: CareerSummary | null;
  love: PlayerState['love'];
}) {
  if (summary === null) return null;
  const groups = honorGroups({ awards, honors, summary, love });
  if (groups.length === 0) return null;

  return (
    <div id="panel-honors">
      <h4>榮譽</h4>
      {groups.map((g) => (
        <div className="tag-group" key={g.caption}>
          <div className="fin-caption">{g.caption}</div>
          <div className="tag-row">
            {g.items.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
