import { useState } from 'react';
import { shownTraits } from './profile.ts';

export function TraitList({
  traits: owned,
  names,
  notes,
  tags = [],
  heading = true,
}: {
  traits: ReadonlySet<string>;
  names: ReadonlyMap<string, string>;
  /** 特性的即時註記（例如七傷拳現在加了多少受傷機率），接在說明後面。 */
  notes?: ReadonlyMap<string, string>;
  /** 特性之外的狀態標籤（已婚：名字），排在特性前面，點開一樣看說明。 */
  tags?: readonly { readonly id: string; readonly label: string; readonly note: string }[];
  /** 記分板裡不帶標題：它接在 SEED 那排下面，那一帶本來就沒有小標。 */
  heading?: boolean;
}) {
  // 點開的那一個。一次只有一個：說明行固定在段落下方，多開就再也分不出哪行在
  // 講哪個標籤（標籤會換行，順序對不上），單開才不必在說明裡重複一次名稱。
  const [picked, setPicked] = useState<string | null>(null);
  const shown: { id: string; label: string; tone: string | undefined; effect_text: string; desc?: string }[] = [
    ...tags.map((t) => ({ id: t.id, label: t.label, tone: undefined, effect_text: t.note })),
    ...shownTraits(owned, names),
  ];
  // 從當下的清單找，而不是記住點下去的那段文字：特性可以在生涯中途消失（受傷
  // 洗掉、負向被覆蓋），留著舊說明會變成一行沒有標籤對應的孤兒。
  const pickedTrait = shown.find((t) => t.id === picked);
  const extra = picked === null ? undefined : notes?.get(picked);
  // 點開顯示**文案**（traits.json 的 desc：一句敘述＋粗體的效果）；沒有文案的退回
  // 效果說明。文案是資料檔寫死的 HTML，不含任何玩家輸入。
  const noteHtml = pickedTrait?.desc;
  const note =
    pickedTrait === undefined ? null : extra === undefined ? pickedTrait.effect_text : `${pickedTrait.effect_text}｜${extra}`;

  return (
    <>
      {/* 間距交給 CSS：在結算卡裡它是卡片的第一行，帶著 12px 會多出一截頭。 */}
      {heading && <h4 className="tl-head">狀態</h4>}
      {shown.length === 0 ? (
        // 記分板裡不留這一行：一開局什麼特性都沒有，一句「還沒有任何特性」會
        // 常駐在版面上好幾年，而它沒有任何資訊。結算卡裡才需要交代空的情況。
        heading ? (
          <p className="stat-pending" style={{ marginTop: 8 }}>
            還沒有任何特性。
          </p>
        ) : null
      ) : (
        <>
          {/* 跟榮譽同一個 tag-row：以前是一段文字靠行高撐開，標籤一換行，第二行就
              貼著第一行的下緣。flex 換行加 gap，上下與左右一樣寬。 */}
          <div className="tag-row" style={{ margin: '8px 0 0' }}>
            {shown.map((t) => (
              // title 留著：桌面想一次掃過五六個特性時，懸停比逐個點快，內容與
              // 下面那行同源。點擊是給觸控用的第二條路——原生 title 在手機上
              // 永遠不會出現，而負向特性的說明是玩家判斷要不要留它的依據。
              <span
                className={`tag pick${picked === t.id ? ' on' : ''}`}
                key={t.id}
                title={t.effect_text}
                onClick={() => setPicked((p) => (p === t.id ? null : t.id))}
                style={t.tone === 'bad' ? BAD_TAG : undefined}
              >
                {t.label}
              </span>
            ))}
          </div>
          {/* 說明不做浮層：這塊所在的位置（記分板、結算卡）都在會捲動或會被裁切
              的容器裡，浮層要嘛被裁掉、要嘛得改用 fixed 自己算座標並在捲動時
              重算。就地展開沒有這些問題，而 effect_text 最長也才 39 字。 */}
          {noteHtml !== undefined ? (
            <p className="tag-note">
              <span dangerouslySetInnerHTML={{ __html: noteHtml }} />
              {extra !== undefined && `｜${extra}`}
            </p>
          ) : (
            <p className={`tag-note${note === null ? ' hint' : ''}`}>{note ?? '點特性看說明'}</p>
          )}
        </>
      )}
    </>
  );
}

/** 負向特性的標籤配色。取自 traits.json 的 tag_styles.negative。 */
const BAD_TAG = { background: '#2a0f0f', borderColor: '#c0392b', color: '#ff8b7a' };
