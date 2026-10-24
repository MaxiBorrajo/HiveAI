import * as XLSX from "xlsx";

export function extractTextFromExcel(bytes: Uint8Array): string {
  const workbook = XLSX.read(bytes, { type: "array" });

  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return `--- Sheet: ${sheetName} ---\n${csv.trim()}`;
  })
    .join("\n\n")
    .trim();
}
