# Board Navigation

## Summary

- `lp` は left panel section、`rp` は right panel mode を表す。
- `lp` は `rp` を変更しない。left/right の state model は完全に分離する。
- canonical default は `lp=overdue&rp=timeline`。
- `Search` / `Overdue` / `Tags` / `Trash` は left self-contained とし、right-panel dedicated view は持たせない。

## Panel Ownership

- Left panel:
  - `none`
  - `overdue`
  - `search`
  - `tags`
  - `trash`
- Right panel:
  - `timeline`
  - `list`

## Strict Canonical Contract

- canonical URL は常に `lp` と `rp` を持つ。
- `date` は `rp=timeline` のときだけ有効。
- `q` は `lp=search` のときだけ有効。
- `tag` は `lp=tags` のときだけ有効。
- serialize は strict に不要パラメータを落とす。

## Invalid URL Policy

- 旧 `view` / `before` / `after` / `range` / `time` query は invalid URL とする。
- `lp` または `rp` が欠ける URL は invalid URL とする。
- contract 外の mode や query も invalid URL とする。
- invalid URL の reset / canonical move 先は `lp=overdue&rp=timeline`。

## Desktop Behavior

- Search:
  - 左パネル内の input と result rows で完結する。
  - 右パネル mode は変更しない。
- Overdue:
  - 左パネル内の overdue cards で完結する。
  - 右パネル mode は変更しない。
- Tags:
  - 未選択時は tag picker のみ表示する。
  - 選択後 0 件なら empty state を表示する。
  - 選択後に一致があれば左パネル内に card rows を表示する。
  - 右パネル mode は変更しない。
- Trash:
  - 左パネル内の trash cards で完結する。
  - 並び順は `purge_after_at asc, deleted_at asc`。
  - 主操作は復元。
  - 右パネル mode は変更しない。

## Mobile Behavior

- Phase 1 では mobile に left-panel 専用 sheet/panel は追加しない。
- mobile では context bar のラベルで current `lp` を示す。
- right panel は current `rp` の内容をそのまま表示する。
- Phase 2 で mobile に desktop 相当の self-contained left UI を追加する。

## Test Matrix

- `lp=search&rp=timeline&q=...` が valid。
- `lp=search&rp=list&q=...` が valid。
- `lp=tags&rp=timeline&tag=...` が valid。
- `lp=tags&rp=list&tag=...` が valid。
- `lp=trash&rp=timeline` が valid。
- `lp=trash&rp=list` が valid。
- `lp` / `rp` 欠落 URL は invalid。
- Search は right panel mode を変えない。
- Search results は left sidebar にのみ出る。
- Tags は left panel 内で未選択 / 0件 / 一致ありを表現する。
