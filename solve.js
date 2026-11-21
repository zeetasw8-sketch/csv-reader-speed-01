// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
// Same answers, byte for byte: BOM dropped, records end at LF/CRLF, blank
// lines are no records, stray CRs dropped (stray_cr), quoted fields run to
// the next non-doubled quote ("" = one quote, CRLF/lone CR inside = LF),
// text after the closing quote is appended as-is (quote_junk), an
// unterminated quote is literal and the rest is re-read unquoted
// (unterminated_quote), quotes inside unquoted fields are literal, fields
// stay strings, rows are padded (short_row) or cut (long_row) to the first
// record's width, errors are {code, line, row} in order met.
//
// Speed: the reference walks one character at a time and concatenates per
// character. This one never does that on the hot path:
//  - records with no quoted field are sliced whole and split(',') at once;
//  - unquoted fields are found by one manual charCodeAt pass (fields here
//    are short, so one pass finding any of ',', LF, CR beats three indexOf
//    calls) and taken as a single slice;
//  - quoted fields find their closing quote with indexOf('"') jumps, and a
//    clean quoted field is one slice; only the rare broken/CR/LF cases run
//    small replace/count passes over the one field involved.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;
  let line = 1;
  let fEnd = END; // how the field being read ended

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = (header && columns === null) ? null : rows.length;

    let fields;
    let lastQuoted = false;

    if (text.charCodeAt(pos) !== 34) {
      // Tier A: maybe a record with no quoted field at all. Slice the whole
      // record (up to its LF) and check for a field-start quote inside it.
      const lf = text.indexOf('\n', pos);
      const recEnd = lf === -1 ? n : lf;
      const seg = text.slice(pos, recEnd);
      if (seg.indexOf(',"') === -1) {
        let s = seg;
        if (s.indexOf('\r') !== -1) {
          // Every CR here is stray except a trailing one that is the CRLF
          // ending the record (only when a LF follows the record).
          let p = -1;
          while ((p = s.indexOf('\r', p + 1)) !== -1) {
            if (p === s.length - 1 && lf !== -1) continue;
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          }
          s = s.replace(/\r/g, '');
        }
        fields = s.split(',');
        pos = lf === -1 ? n : lf + 1;
        if (lf !== -1) line += 1;
      }
      // Else: the record holds a quoted field; Tier B below.
    }

    if (fields === undefined) {
      // Tier B: the record holds a quoted field; read it field by field.
      fields = [];
      do {
        let val;
        let scan = true; // run the unquoted scan below (fresh field or junk)
        let junkBefore = -1; // >= 0 when scanning junk after a closing quote
        if (text.charCodeAt(pos) === 34) {
          lastQuoted = true;
          const open = pos;
          const openLine = line;
          // One manual pass over the quoted field: finds the closing quote
          // ("" = one quote), counts line breaks (LF, CRLF, lone CR) and
          // notes doubled quotes / CRs for the transforms below.
          let i = pos + 1;
          let closed = -1;
          let doubled = false;
          let breaks = 0;
          let hasCR = false;
          while (i < n) {
            const c = text.charCodeAt(i);
            if (c === 34) {
              if (text.charCodeAt(i + 1) === 34) { doubled = true; i += 2; continue; }
              closed = i;
              break;
            }
            if (c === 10) { breaks += 1; i += 1; continue; }
            if (c === 13) { breaks += 1; hasCR = true; i += (text.charCodeAt(i + 1) === 10) ? 2 : 1; continue; }
            i += 1;
          }
          if (closed === -1) {
            // The quote never closes: literal, re-read as unquoted.
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            pos = open + 1;
            line = openLine;
            val = '"';
          } else {
            let v = text.slice(open + 1, closed);
            if (doubled) v = v.replace(/""/g, '"');
            // CRLF and lone CR inside quotes are each one LF (breaks
            // already counted by the scan above).
            if (hasCR) v = v.replace(/\r\n?/g, '\n');
            line += breaks;
            pos = closed + 1;
            if (pos >= n) { val = v; fEnd = END; scan = false; }
            else {
              const ch = text.charCodeAt(pos);
              if (ch === 44) { pos += 1; val = v; fEnd = COMMA; scan = false; }
              else if (ch === 10) { pos += 1; line += 1; val = v; fEnd = LINE_BREAK; scan = false; }
              else if (ch === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; val = v; fEnd = LINE_BREAK; scan = false; }
              else {
                // Junk after the closing quote, appended as it stands.
                junkBefore = v.length;
                val = v;
              }
            }
          }
        } else {
          lastQuoted = false;
          val = '';
        }
        if (scan) {
          // Unquoted scan: one manual pass finds ',', LF or CR; the field
          // is a single slice (plus rare stray-CR segments).
          for (;;) {
            let i = pos;
            let c = 0;
            while (i < n) {
              c = text.charCodeAt(i);
              if (c === 44 || c === 10 || c === 13) break;
              i++;
            }
            if (i >= n) { val += text.slice(pos, n); pos = n; fEnd = END; break; }
            if (c === 44) { val += text.slice(pos, i); pos = i + 1; fEnd = COMMA; break; }
            if (c === 10) { val += text.slice(pos, i); pos = i + 1; line += 1; fEnd = LINE_BREAK; break; }
            if (text.charCodeAt(i + 1) === 10) { val += text.slice(pos, i); pos = i + 2; line += 1; fEnd = LINE_BREAK; break; }
            // Stray CR: dropped, reported, and the field goes on.
            val += text.slice(pos, i);
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            pos = i + 1;
          }
          if (junkBefore >= 0 && val.length > junkBefore) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        }
        fields.push(val);
      } while (fEnd === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.slice(width) });
      fields.length = width;
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
