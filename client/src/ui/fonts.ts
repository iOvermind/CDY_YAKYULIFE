/**
 * 字型隨產物出貨，不從 Google Fonts 載入（ADR 0056）。
 *
 * 字重照介面實際用到的那幾種，一種一個 CSS：中文字型依 unicode-range 切成上百片，
 * 瀏覽器只下載畫面上出現過的字所在的那幾片，跟從 Google 載入時一樣。
 *
 * - `--sans`／`--head`（主題 a、d）：Noto Sans TC 400／500／700／900
 * - `--head`／`--disp`（主題 c）：Noto Serif TC 500／700／900
 * - `--mono`／`--disp`：IBM Plex Mono 500／700
 * - `--head`／`--disp`（主題 b）：DotGothic16（只有一種字重）
 */
import '@fontsource/noto-sans-tc/400.css';
import '@fontsource/noto-sans-tc/500.css';
import '@fontsource/noto-sans-tc/700.css';
import '@fontsource/noto-sans-tc/900.css';
import '@fontsource/noto-serif-tc/500.css';
import '@fontsource/noto-serif-tc/700.css';
import '@fontsource/noto-serif-tc/900.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/dotgothic16/400.css';
