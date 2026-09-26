import { schoolTiersOf } from '../../engine/amateur.ts';
import type { PlayerState } from '../../engine/game.ts';
import type { Rating } from '../../engine/rating.ts';
import { fmtMoneyShort } from '../../engine/salary.ts';
import { FitValue } from '../common/FitValue.tsx';
import { TraitList } from '../player/TraitList.tsx';
import { hand, relationTags, roleLabelOf, sortHonors } from '../player/profile.ts';
import styles from './Board.module.css';
import tag from '../player/tag.module.css';
import { Heading } from '../common/Heading.tsx';

export function Board({
  state,
  rating,
  seed,
}: {
  state: PlayerState;
  rating: Rating | null;
  seed: string;
}) {
  const player = state.origin;
  // 所屬單位一律讀目前的狀態：升學會換學校、選秀會換成球隊。讀 origin 那一份
  // 會永遠停在開局的國中，讀 state.school 則會在進職業之後停在高中。
  const tierLabel = schoolTiersOf(state.stage)?.tiers[String(state.schoolTier)]?.label ?? '';
  // 引退之後球團關係已經結束，但這一格要停在他掛靴的地方——退回學校會讓一段
  // 二十年的職業生涯在落幕那一刻變回高中生（見 PlayerState.retiredFrom）。
  const affiliation =
    state.pro !== null
      ? { name: state.pro.team, note: state.pro.levelName }
      : state.retiredFrom !== null
        ? { name: state.retiredFrom.team, note: `${state.retiredFrom.levelName}·引退` }
        : { name: state.school, note: tierLabel };

  // 取得二刀流之後，起始守位就不再說明他是什麼球員了——他是投手也是打者，
  // 因此寫成兩個守位。不再冠上「二刀流」三個字：右欄的狀態欄已經會列出這個
  // 特性，寫兩次只是佔位。
  // 野手側的守位由守備能力決定：守得動就站守位，守不動就是 DH，這也是多數
  // 投手出身的二刀流的歸宿。
  // 寫英文代碼（P＋DH），不寫「投手＋指定打擊」——姓名那一行還要擠慣用手，
  // 中文全稱會把它撐到換行。
  //
  // 進了頂級聯盟就寫**現在登錄的守位**，不是起始守位：移防之後那兩者會分岔，
  // 而右欄已經不另外列一格了，這裡停在舊守位的話就沒有地方看得到現況。
  //
  // 養成期與二軍寫的是**同一份登錄守位**（ADR 0037）——它從入學那一刻就存在，
  // 起點是玩家選的起始守位，之後每年由守位會議往上或往下調。引擎那邊的出賽勞損
  // 也吃同一個位置，介面不另外算一份。
  //
  // 純投手只寫 P。養成期他的守位欄是 DH（那是打席的落點，成績要標），但姓名旁
  // 寫 P＋DH 會把他說成二刀流——他只是還沒被免除打擊而已。
  // 投手寫**定位**而不是一個沒有資訊量的 P——先發、終結、布局、中繼、長中繼是
  // 五種不同的球員，跟守位一樣每季重新判定。還沒進職業之前沒有牛棚分工，那時
  // 就是 P。
  const roleLabel = roleLabelOf(state);
  return (
    <div id="board" className={styles.board}>
      <Heading>球員</Heading>
      <div id="bd-top" className={styles.bdTop}>
        <span id="bd-name" className={styles.bdName}>
          {/* 合約剩餘年數放在姓名上方——那塊空白本來就對著隊名側的奪冠機率，
              兩邊各自佔一行。它是「我還剩幾年安穩」，屬於處境，不是能力，因此
              不進下面的方格。 */}
          {state.pro !== null && <small className={styles.deal}>約 {state.pro.contractYears} 年</small>}
          {player.name}
          <small>
            {roleLabel}·投{hand(player.throws)}打{hand(player.bats)}
          </small>
        </span>
        <span id="bd-team" className={styles.bdTeam}>
          {/* 奪冠機率放在隊名上方自成一行。它講的是球隊的處境，不是球員的
              頭銜——擠在隊名後面會跟層級混成一串讀不出重點。 */}
          {state.pro !== null && (
            <small className={styles.odds}>
              奪冠 {Math.round(state.pro.championshipOdds * 100)}%
            </small>
          )}
          {affiliation.name}
          {affiliation.note !== '' && (
            <small style={{ opacity: 0.75 }}>·{affiliation.note}</small>
          )}
        </span>
      </div>
      <div id="bd-grid" className={styles.bdGrid}>
        <div className={styles.bdCell}>
          <b>{state.year}</b>
          <span>年份</span>
        </div>
        <div className={styles.bdCell}>
          <b>{state.age}</b>
          <span>年齡</span>
        </div>
        {/* 二刀流寫兩個數字：他是兩種球員，一個數字說不完，而右欄那兩格
            「投手側／野手側」已經收掉了，這裡不寫就沒有地方看得到。
            單邊的人仍寫 overall——那才是升降級判定吃的那個數字（含 yips 之類的
            特性修正），寫成側評價會跟卡片上的「綜合 X」對不起來（ADR 0029）。 */}
        {state.visibleSide === null ? (
          <div className={styles.bdCell}>
            {/* 斜線兩側不留空格，且字級隨寬度自動縮：兩個數字比一個長，方格
                的寬度卻是四等分的固定值，換行會把整排方格頂高一截。**寧可字
                小一點也不要版面跳動**——這一格在整局裡只有二刀流會用到，為它
                改動所有人的版面高度是本末倒置。 */}
            <FitValue>
              {rating?.pitcher ?? 0}/{rating?.fielder ?? 0}
            </FitValue>
            <span>投/野</span>
          </div>
        ) : (
          <div className={styles.bdCell}>
            <b>{rating?.overall ?? 0}</b>
            <span>綜合</span>
          </div>
        )}
        <div className={styles.bdCell}>
          <b>{state.pool}</b>
          <span>可分配點</span>
        </div>
      </div>
      {/* 年薪與生涯收入併成一行。兩個都是錢，分成兩格只是把同一件事切開；
          斜線左邊是今年拿多少，右邊是這輩子拿過多少。 */}
      {state.pro !== null && (
        <div id="bd-money" className={styles.bdMoney}>
          {fmtMoneyShort(state.pro.salary)}
          {state.earnings > 0 && <span> / {fmtMoneyShort(state.earnings)}</span>}
        </div>
      )}
      <div id="lamps" className={styles.lamps}>
        <span className={`${styles.lamp} ${styles.on}`}>
          <i />
          SEED {seed}
        </span>
        {/* 身體狀態：耐力只給狀態字、不給數字（ADR 0051）。二刀流兩池各一盞。 */}
        {state.endurance?.fielder != null && (
          <span className={`${styles.lamp} ${styles.on}`} title="野手的耐力：守位的消耗扣在這裡，指定打擊是純恢復">
            <i />
            身體 {state.endurance.fielder}
          </span>
        )}
        {state.endurance?.pitcher != null && (
          <span className={`${styles.lamp} ${styles.on}`} title="投手的耐力：投球局數扣在這裡；耗盡要開 TJ">
            <i />
            手臂 {state.endurance.pitcher}
          </span>
        )}
        {state.honors.length > 0 && (
          // 清單掛在滑鼠停留的提示上。生涯累積下來會有十幾項，攤在版面上會把
          // 記分板撐開，而它們平常並不需要被讀。
          <span className={`${styles.lamp} ${styles.on} ${styles.honors}`} title={sortHonors(state.honors).join('\n')}>
            <i />
            榮譽 {state.honors.length}
          </span>
        )}
      </div>
      {/* 特性接在 SEED 那排下面。**這一份只有手機看得到**（桌面由右欄的成績
          面板負責，見 tag.module.css 的 .bd-traits）：手機把成績面板整塊收掉，狀態得有地方去，而
          記分板是釘在畫面頂端、兩頁都看得到的那一塊。
          同一個 `TraitList`，只是不帶「狀態」小標——這一帶（年薪、SEED、榮譽）
          本來就沒有小標。 */}
      <div id="bd-traits" className={tag.bdTraits}>
        <TraitList traits={state.traits} names={state.traitNames} notes={state.traitNotes} tags={relationTags(state)} heading={false} />
      </div>
    </div>
  );
}
