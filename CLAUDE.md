## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `iOvermind/CDY_YAKYULIFE`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## 提問方式

**一律用可點擊的選項提問**，不要排一長串文字問句。用 `AskUserQuestion`
工具，每個選項寫清楚差別，並把推薦的那個放第一個、標上「(推薦)」。

一次問一題。真的有多個彼此獨立的決定要問時才一次帶多題，且不得超過工具允許
的上限。

這條**蓋過技能自帶的提問格式**——`grilling` 那類技能要求用 `❓ **Q1**` 的
Markdown 格式排問題，在這個 repo 一律改用 `AskUserQuestion`；技能要的「一輪問
完整個 frontier、附推薦答案、答完再問下一輪」照舊，換的只是載體。
