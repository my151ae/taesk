# Board Navigation

## Summary

- `pp` は primary panel section、`mp` は main panel mode を表す。
- `pp` は `mp` を変更しない。primary/main の state model は完全に分離する。
- canonical default は `pp=overdue&mp=timeline`。
- `Search` / `Overdue` / `Completed` / `Tags` / `Trash` は primary self-contained とし、main-panel dedicated view は持たせない。
- desktop / mobile は同じ `BoardUiState` を共有し、viewport を理由に `mp` を別 mode へ書き換えない。

## Panel Ownership

- Primary panel:
  - `none`
  - `overdue`
  - `completed`
  - `search`
  - `tags`
  - `trash`
- Main panel:
  - `timeline`
  - `list`
  - `month`

## Strict Canonical Contract

- canonical URL は常に `pp` と `mp` を持つ。
- `date` は `mp=timeline` / `mp=month` のとき有効。
- `q` は `pp=search` のときだけ有効。
- `tag` は `pp=tags` のときだけ有効。
- `checked` / `unchecked` は `pp=tags` のときだけ有効。
- serialize は strict に不要パラメータを落とす。

## Invalid URL Policy

- 旧 `view` / `before` / `after` / `range` / `time` query は invalid URL とする。
- `pp` または `mp` が欠ける URL は invalid URL とする。
- contract 外の mode や query も invalid URL とする。
- invalid URL の reset / canonical move 先は `pp=overdue&mp=timeline`。

## Desktop Behavior

- Search:
  - 左パネル内の input と result rows で完結する。
  - 右パネル mode は変更しない。
- Overdue:
  - 左パネル内の overdue cards で完結する。
  - 右パネル mode は変更しない。
- Completed:
  - 左パネル内の completed cards で完結する。
  - 並び順は `checked_at desc`。
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
- mobile では context bar のラベルで current `pp` を示す。
- main panel は current `mp` の内容をそのまま表示する。
- `mp=month` も mobile でそのまま描画する。
- Phase 2 で mobile に desktop 相当の self-contained left UI を追加する。

## Test Matrix

- `pp=search&mp=timeline&q=...` が valid。
- `pp=search&mp=list&q=...` が valid。
- `pp=search&mp=month&q=...` が valid。
- `pp=tags&mp=timeline&tag=...` が valid。
- `pp=tags&mp=list&tag=...` が valid。
- `pp=tags&mp=month&tag=...` が valid。
- `pp=trash&mp=timeline` が valid。
- `pp=trash&mp=list` が valid。
- `pp=trash&mp=month` が valid。
- `pp=completed&mp=timeline` が valid。
- `pp=completed&mp=list` が valid。
- `pp=completed&mp=month` が valid。
- `pp` / `mp` 欠落 URL は invalid。
- Search は right panel mode を変えない。
- Search results は left sidebar にのみ出る。
- Tags は left panel 内で未選択 / 0件 / 一致ありを表現する。
