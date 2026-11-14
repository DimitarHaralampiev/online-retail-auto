// Minimal RFC 4180 CSV reader for admin imports (no dependency).
//
// Handles quoted fields with embedded delimiters, quotes ("") and line
// breaks, CRLF/LF/CR line endings and a UTF-8 byte-order mark. The delimiter
// is detected from the header line: Excel in Bulgarian locale writes ";",
// most tools write ",".

export class CsvError extends Error {}

export type CsvTable = {
  delimiter: "," | ";" | "\t";
  header: string[];
  /** Data rows with their 1-based line number in the file. */
  rows: { line: number; cells: string[] }[];
};

function detectDelimiter(text: string): CsvTable["delimiter"] {
  // Count candidates outside quotes on the first line only.
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && char in counts) counts[char as keyof typeof counts]++;
  }
  const best = (Object.keys(counts) as (keyof typeof counts)[]).reduce(
    (a, b) => (counts[b] > counts[a] ? b : a),
  );
  return counts[best] > 0 ? best : ",";
}

/**
 * Parses CSV text. Throws CsvError for an unterminated quote, an empty file
 * or more than `maxRows` data rows. Blank lines are skipped.
 */
export function parseCsv(input: string, maxRows = 5000): CsvTable {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (!text.trim()) throw new CsvError("Файлът е празен.");
  const delimiter = detectDelimiter(text);
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let afterQuote = false;
  const endRecord = () => {
    cells.push(cell);
    if (cells.length > 1 || cells[0].trim() !== "")
      records.push({ line: recordLine, cells });
    if (records.length > maxRows + 1)
      throw new CsvError(`Файлът е с над ${maxRows} реда.`);
    cells = [];
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        if (char === "\n" || (char === "\r" && text[i + 1] !== "\n")) line++;
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "" && !afterQuote) {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = "";
      afterQuote = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      afterQuote = false;
      line++;
      recordLine = line;
    } else if (afterQuote) {
      throw new CsvError(
        `Ред ${line}: след затваряща кавичка се очаква разделител.`,
      );
    } else {
      cell += char;
    }
  }
  if (quoted) throw new CsvError(`Ред ${recordLine}: незатворени кавички.`);
  if (cell !== "" || cells.length) endRecord();
  const [head, ...rows] = records;
  if (!head) throw new CsvError("Файлът е празен.");
  return {
    delimiter,
    header: head.cells.map((name) => name.trim().toLowerCase()),
    rows,
  };
}
