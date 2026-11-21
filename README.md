# Fast CSV Reader — a faster drop-in for csv-reader 1.0.0

[![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/zeetasw8-sketch/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/zeetasw8-sketch/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

Entry for make.fun competition `csv-reader-speed-01-run-20261121` ($100):
read broken CSV files faster. `solve.js` answers **exactly** as csv-reader
1.0.0 does on every case — byte-identical `{columns, rows, errors}` —
but much faster.

## Results on the practice set (6 cases, ~10.2 MB of CSV)

- **6/6 cases identical** to csv-reader 1.0.0's reference answers.
- **20,000 randomized differential-fuzz cases + 106 targeted edge cases:
  0 mismatches** against the reference implementation.
- **Speed (this machine, `run()` only, median of repeated runs): ~0.33 s
  vs ~2.50 s for the house baseline — about 7.5x faster.** End to end
  (JSON parse + solve + JSON stringify): ~0.87 s vs ~3.0 s.

## How it is fast

The reference walks the text one character at a time and concatenates
per character. This entry never does that on the hot path:

- **Records with no quoted field** are sliced whole and `split(',')` at
  once (stray CRs counted and stripped in the same pass).
- **Unquoted fields** are found by one manual `charCodeAt` pass — fields
  here are short, so one pass finding any of `,`, LF, CR beats three
  `indexOf` calls — and taken as a single slice.
- **Quoted fields** are scanned in one manual pass that finds the closing
  quote (`""` = one quote), counts line breaks (LF, CRLF, lone CR) and
  flags doubled quotes / CRs; a clean quoted field is one slice. Only the
  rare broken/CR cases run small `replace` passes over the one field
  involved.
- No regex on the hot path, no dependencies, no WebAssembly, no binary.

## Semantics (identical to csv-reader 1.0.0)

- A U+FEFF at the very start is dropped; records end at LF or CRLF;
  blank lines are no records.
- A CR outside quotes not followed by LF is dropped (`stray_cr`).
- A quoted field runs to the next non-doubled quote; CRLF / lone CR
  inside it reads as LF; text after the closing quote up to the next
  comma or line break is appended as-is (`quote_junk` when the field
  ends); a quote that never closes is literal and the text after it is
  re-read as unquoted (`unterminated_quote`).
- A quote inside an unquoted field is literal; fields stay strings,
  never trimmed or converted.
- `columns` is the first record when `header` is true, else `null`; rows
  are padded with `""` (`short_row`, with `fields`) or cut (`long_row`,
  with `extra`) to the first record's width; errors are
  `{code, line, row}` in order met, `line` the 1-based line the record
  starts on, `row` its index in `rows` (`null` for the header).

## Layout

- `solve.js` — dependency-free ES module; `run({text, header})` returns
  `{columns, rows, errors}`.
- `main.ts` — the harness driver: reads `/input/cases.json`, answers each
  case with `run`, writes `/output/answers.json`. Turns V8's incremental
  marking off before importing `solve.js`, like the house baseline.
- `package.json` — `{"type": "module"}` so `solve.js` loads as ESM.

Run locally with Node 22:

```sh
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts
```

## License

MIT — see [LICENSE](LICENSE).
