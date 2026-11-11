/**
 * Tests de la detección automática de columnas (Vitest).
 *
 *   npx vitest run smartColumns.test.ts
 *
 * Necesita `xlsx` (SheetJS), que el proyecto ya usa para leer los Excel, y `vitest`.
 * Los Excel de prueba y lo que debe salir de cada uno están en ./excels/.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import {
  type ColumnField,
  type ColumnMapping,
  type Row,
  headerField,
  isGtin,
  isSummaryRowName,
  isUsableMapping,
  smartColumns,
} from "./smartColumns";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Parser de importes equivalente al de la app (parse.ts), incluido el menos final de los abonos ("5,00-").
 * En el código fuente, usar el parser real en lugar de este.
 */
function parseMoney(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  let s = String(value).replace(/[€$£]|EUR|USD/gi, "").replace(/[​-‍﻿   ]/g, "").trim();
  if (!s) return undefined;
  const negative = /^-|-$|^\(.*\)$/.test(s);
  s = s.replace(/[()\-+]/g, "").trim();
  if (!/^\d[\d.,\s]*$/.test(s)) return undefined;
  s = s.replace(/\s/g, "");
  const comma = s.lastIndexOf(","), dot = s.lastIndexOf(".");
  if (comma !== -1 && dot !== -1) s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (comma !== -1) { const parts = s.split(","); s = parts.length > 2 ? parts.join("") : s.replace(",", "."); }
  else if (dot !== -1) { const parts = s.split("."); if (parts.length > 2) s = parts.join(""); }
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : undefined;
}

/** Igual que la app al leer un Excel: primera hoja, una fila por array, números como números. */
function readRows(file: string): Row[] {
  const wb = XLSX.read(readFileSync(file), { type: "buffer", raw: false, cellText: true });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false });
}

interface Line { barcode: string; productName: string; quantity?: number; cost?: number; lineTotal?: number }

/** Convierte filas en líneas como la app (ReviewSave): salta filas sin código ni nombre, y las de totales sin código. */
function toLines(rows: Row[], headerRowIndex: number, m: ColumnMapping): Line[] {
  const out: Line[] = [];
  const get = (r: ReadonlyArray<unknown>, f: ColumnField) => (m[f] === undefined ? null : r[m[f]!]);
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const bc = String(get(r, "barcode") ?? "").trim();
    const name = String(get(r, "productName") ?? "").trim();
    const validBc = isGtin(bc);
    if (!validBc && (!name || isSummaryRowName(name))) continue;
    const q = parseMoney(get(r, "quantity")), u = parseMoney(get(r, "unitPrice")), d = parseMoney(get(r, "discountPercent")) ?? 0;
    const f = parseMoney(get(r, "finalUnitPrice"));
    out.push({ barcode: bc, productName: name, quantity: q, cost: f ?? (u === undefined ? undefined : u * (1 - d / 100)), lineTotal: parseMoney(get(r, "lineTotal")) });
  }
  return out;
}

const expected: Record<string, { columnas: ColumnMapping; lineas: Array<{ barcode: string; productName: string; quantity: number; finalUnitPrice: number; lineTotal: number }> }> =
  JSON.parse(readFileSync(join(HERE, "excels", "esperado.json"), "utf8"));

describe("Excel de prueba (excels/)", () => {
  for (const [name, exp] of Object.entries(expected)) {
    it(`${name}: asigna todas las columnas y pasa directo a revisión`, () => {
      const rows = readRows(join(HERE, "excels", `${name}.xlsx`));
      const res = smartColumns(rows, parseMoney);
      expect(res.mapping).toEqual(exp.columnas);
      expect(isUsableMapping(res.mapping)).toBe(true);
    });
    it(`${name}: las líneas salen exactas (código, nombre, cantidad, coste, importe)`, () => {
      const rows = readRows(join(HERE, "excels", `${name}.xlsx`));
      const res = smartColumns(rows, parseMoney);
      const lines = toLines(rows, res.headerRowIndex, res.mapping);
      expect(lines).toHaveLength(exp.lineas.length);
      lines.forEach((l, i) => {
        const e = exp.lineas[i];
        expect(l.barcode).toBe(e.barcode);
        expect(l.productName).toBe(e.productName);
        expect(l.quantity).toBe(e.quantity);
        expect(l.cost).toBeCloseTo(e.finalUnitPrice, 2);
        expect(l.lineTotal).toBeCloseTo(e.lineTotal, 2);
      });
    });
  }
});

describe("Cabeceras", () => {
  const cases: Array<[string, ReturnType<typeof headerField>]> = [
    // código de barras
    ["Código EAN", "barcode"], ["EAN13", "barcode"], ["Cod. Barras", "barcode"], ["Código de barras", "barcode"], ["Barcode", "barcode"], ["GTIN", "barcode"], ["C.B.", "barcode"], ["条码", "barcode"], ["条形码", "barcode"],
    // referencia
    ["Ref", "reference"], ["Referencia", "reference"], ["SKU", "reference"], ["Cód. art.", "reference"], ["Código interno", "reference"], ["Modelo", "reference"], ["货号", "reference"], ["编号", "reference"],
    // nombre
    ["Descripción", "productName"], ["Descripción artículo", "productName"], ["Artículo", "productName"], ["Concepto", "productName"], ["Denominación", "productName"], ["Item", "productName"], ["品名", "productName"], ["商品名称", "productName"],
    // cantidad
    ["Cantidad", "quantity"], ["Cant.", "quantity"], ["Uds.", "quantity"], ["Unidades", "quantity"], ["Qty", "quantity"], ["Cajas", "quantity"], ["数量", "quantity"],
    // precio
    ["Precio", "unitPrice"], ["Precio Unit.", "unitPrice"], ["P. Unit", "unitPrice"], ["Unit Price", "unitPrice"], ["Tarifa", "unitPrice"], ["Coste", "unitPrice"], ["单价", "unitPrice"],
    // descuento
    ["Dto", "discountPercent"], ["Dto. %", "discountPercent"], ["Descuento", "discountPercent"], ["Discount", "discountPercent"], ["折扣", "discountPercent"],
    // precio neto / final
    ["Precio neto", "finalUnitPrice"], ["P. Neto", "finalUnitPrice"], ["Precio final", "finalUnitPrice"], ["Net price", "finalUnitPrice"], ["净价", "finalUnitPrice"],
    // importe ("Importe neto" es importe, no precio neto)
    ["Importe", "lineTotal"], ["Importe neto", "lineTotal"], ["Total", "lineTotal"], ["Subtotal", "lineTotal"], ["Amount", "lineTotal"], ["金额", "lineTotal"], ["总价", "lineTotal"],
    // ambiguo: lo decide el contenido
    ["Código", "code"], ["Cod", "code"],
    // nada
    ["IVA %", null], ["Peso kg", null], ["", null], [null as unknown as string, null],
  ];
  it.each(cases)("«%s» → %s", (header, field) => {
    expect(headerField(header)).toBe(field);
  });
  it("«Descripción» no se confunde con «Descuento»", () => {
    expect(headerField("Descripción")).toBe("productName");
    expect(headerField("Desc. %")).toBe("discountPercent");
  });
});

describe("Código de barras (GTIN)", () => {
  it.each(["8412345678905", "84123459", "012345678905", "18412345678902"])("%s es válido", (c) => {
    expect(isGtin(c)).toBe(true);
  });
  it("acepta el código como número", () => expect(isGtin(8412345678905)).toBe(true));
  it.each(["8412345678904", "841234567890", "ABC", "", "8412345678905.5"])("%s no es válido", (c) => {
    expect(isGtin(c)).toBe(false);
  });
});

describe("Filas de totales", () => {
  it.each(["TOTAL", "Total albarán", "SUBTOTAL", "Suma", "Base imponible", "IVA 21%", "合计", "总计", "小计"])("«%s» es una fila de totales", (n) => {
    expect(isSummaryRowName(n)).toBe(true);
  });
  it.each(["TAZA CERAMICA", "TOTALMENTE NUEVO", "Totalizador digital", "VASO"])("«%s» es un producto", (n) => {
    expect(isSummaryRowName(n)).toBe(false);
  });
});

describe("Casos límite", () => {
  it("solo la fila de cabeceras (lo que usa la pantalla manual al elegir fila)", () => {
    const res = smartColumns([["EAN", "Descripción", "Cant.", "Precio", "Importe"]], parseMoney);
    expect(res.mapping).toEqual({ barcode: 0, productName: 1, quantity: 2, unitPrice: 3, lineTotal: 4 });
  });
  it("sin códigos de barras: no pasa directo, pero deja el resto asignado para la pantalla manual", () => {
    const rows: Row[] = [["Referencia", "Descripción", "Cantidad", "Precio", "Importe"], ["A-1", "TAZA", 12, 1.2, 14.4], ["A-2", "VASO", 6, 0.95, 5.7], ["A-3", "PLATO", 24, 1.5, 36]];
    const res = smartColumns(rows, parseMoney);
    expect(isUsableMapping(res.mapping)).toBe(false);
    expect(res.mapping).toEqual({ reference: 0, productName: 1, quantity: 2, unitPrice: 3, lineTotal: 4 });
  });
  it("hoja vacía", () => {
    expect(smartColumns([], parseMoney)).toEqual({ headerRowIndex: -1, mapping: {}, headers: [] });
  });
  it("importes como texto en formato español («1.234,56»)", () => {
    const rows: Row[] = [["EAN", "Producto", "Uds", "Precio", "Importe"], ["8412345678905", "LAMPARA", "2", "617,28", "1.234,56"], ["84123459", "MESA", "1", "1.000,00", "1.000,00"], ["8410000000016", "SILLA", "4", "25,50", "102,00"]];
    expect(smartColumns(rows, parseMoney).mapping).toMatchObject({ barcode: 0, productName: 1, quantity: 2, unitPrice: 3, lineTotal: 4 });
  });
  it("sin cabecera: los datos empiezan en la primera fila con código de barras", () => {
    const rows: Row[] = [["DISTRIBUCIONES CHEN SL"], ["Albarán 2026/1", "15/10/2026"], ["8412345678905", "TAZA", 12, 1.2, 14.4], ["84123459", "VASO", 6, 0.95, 5.7], ["8410000000016", "PLATO", 24, 1.5, 36]];
    const res = smartColumns(rows, parseMoney);
    expect(res.headerRowIndex).toBe(1);
    expect(res.mapping).toMatchObject({ barcode: 0, productName: 1, quantity: 2, unitPrice: 3, lineTotal: 4 });
  });
  it("precio bruto + descuento + neto sin cabeceras: los tres en su sitio", () => {
    const withCheck = (d12: string) => { let t = 0; d12.split("").reverse().forEach((x, i) => (t += +x * (i % 2 === 0 ? 3 : 1))); return d12 + ((10 - (t % 10)) % 10); };
    const rows: Row[] = [[12, 2, 10], [6, 1.5, 0], [24, 3, 5], [4, 10, 15], [10, 0.8, 10]].map(([q, u, d], i) => {
      const f = Math.round(u * (1 - d / 100) * 100) / 100;
      return [withCheck("84100000000" + i), "PRODUCTO " + i, q, u, d, f, Math.round(q * f * 100) / 100];
    });
    expect(smartColumns(rows, parseMoney).mapping).toEqual({ barcode: 0, productName: 1, quantity: 2, unitPrice: 3, discountPercent: 4, finalUnitPrice: 5, lineTotal: 6 });
  });
  it("una columna «IVA %» no se toma por descuento", () => {
    const rows: Row[] = [["EAN", "Artículo", "IVA %", "Cantidad", "Precio", "Importe"], ["8412345678905", "TAZA", 21, 12, 1.2, 14.4], ["84123459", "VASO", 21, 6, 0.95, 5.7], ["8410000000016", "PLATO", 10, 24, 1.5, 36]];
    const res = smartColumns(rows, parseMoney);
    expect(res.mapping.discountPercent).toBeUndefined();
    expect(res.mapping).toMatchObject({ quantity: 3, unitPrice: 4, lineTotal: 5 });
  });
});

describe("Aleatorio (semilla fija)", () => {
  // Excel generados con columnas en cualquier orden, cabeceras es/en/zh o sin cabecera, columnas que despistan
  // (IVA %, peso, PVP recomendado…), membrete arriba, fila de total abajo y códigos como número o texto.
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const ean = () => { const d = "84" + Array.from({ length: 10 }, () => Math.floor(rnd() * 10)).join(""); let t = 0; d.split("").reverse().forEach((x, i) => (t += +x * (i % 2 === 0 ? 3 : 1))); return d + ((10 - (t % 10)) % 10); };
  const HDR: Record<ColumnField, string[]> = {
    barcode: ["Código EAN", "EAN", "EAN13", "Cod. Barras", "Código de barras", "Barcode", "条码", "条形码", "GTIN", "C.B."],
    reference: ["Ref", "Referencia", "Ref.", "SKU", "Cód. art.", "货号", "编号", "Modelo"],
    productName: ["Descripción", "Artículo", "Producto", "Concepto", "Denominación", "Item", "Description", "品名", "商品名称", "名称"],
    quantity: ["Cantidad", "Cant.", "Uds.", "Unidades", "Qty", "数量", "Cajas", "Piezas"],
    unitPrice: ["Precio", "Precio Unit.", "P. Unit", "Unit Price", "Tarifa", "单价", "Coste"],
    discountPercent: ["Dto", "Dto. %", "Descuento", "Discount", "折扣"],
    finalUnitPrice: ["Precio neto", "P. Neto", "Precio final", "Net price", "净价"],
    lineTotal: ["Importe", "Total", "Importe neto", "Subtotal", "Amount", "金额", "总价"],
  };
  const JUNK: Array<[string, () => unknown]> = [["IVA %", () => pick([21, 10, 4])], ["Peso kg", () => r2(rnd() * 5)], ["PVP recomendado", () => r2(1 + rnd() * 30)], ["Lote", () => "L" + Math.floor(rnd() * 999)], ["Ubicación", () => pick(["A1", "B3", "C2"])]];
  const NAMES = ["TAZA CERAMICA 9CM", "VASO CRISTAL 25CL", "PLATO HONDO", "JARRA AGUA 1L", "CESTA MIMBRE", "VELA AROMATICA", "MARCO FOTO", "RELOJ PARED", "COJIN 40X40", "ESPEJO"];

  it("1.000 Excel: lo esencial (código, nombre, cantidad, importe y coste) bien en todos, y nunca pide asignar a mano", () => {
    let essentialOk = 0, manual = 0;
    const N = 1000;
    for (let it = 0; it < N; it++) {
      const useD = rnd() < 0.4, useF = useD ? rnd() < 0.7 : rnd() < 0.2, useRef = rnd() < 0.6, hasHeader = rnd() < 0.8;
      const nJunk = Math.floor(rnd() * 3), nPre = hasHeader ? Math.floor(rnd() * 5) : 0, n = 3 + Math.floor(rnd() * 30);
      const fields: ColumnField[] = ["barcode", "productName", "quantity", "unitPrice", "lineTotal", ...(useD ? ["discountPercent" as const] : []), ...(useF ? ["finalUnitPrice" as const] : []), ...(useRef ? ["reference" as const] : [])];
      const cols = [...fields.map((f) => ({ f, junk: undefined as [string, () => unknown] | undefined })), ...Array.from({ length: nJunk }, () => ({ f: undefined as ColumnField | undefined, junk: pick(JUNK) }))].sort(() => rnd() - 0.5);
      const bcAsNum = rnd() < 0.5, textNums = rnd() < 0.15;
      const rows: unknown[][] = [];
      for (let i = 0; i < nPre; i++) rows.push([pick(["DISTRIBUCIONES CHEN SL", "Albarán nº 2026/" + i, "Cliente: BAZAR", "Fecha 15/10/2026"])]);
      if (hasHeader) rows.push(cols.map((c) => (c.f ? pick(HDR[c.f]) : c.junk![0])));
      const truth: Array<{ bc: string; name: string; q: number; cost: number; t: number }> = [];
      for (let i = 0; i < n; i++) {
        const q = pick([1, 2, 3, 4, 6, 10, 12, 24, 36, 48]), u = r2(0.3 + rnd() * 20), d = useD ? pick([0, 0, 5, 10, 15]) : 0, f = r2(u * (1 - d / 100)), t = r2(q * f), bc = ean();
        const v: Record<ColumnField, unknown> = { barcode: bcAsNum ? +bc : bc, reference: "A-" + (1000 + i), productName: pick(NAMES), quantity: q, unitPrice: u, discountPercent: d, finalUnitPrice: f, lineTotal: t };
        truth.push({ bc, name: v.productName as string, q, cost: useF ? f : r2(u * (1 - d / 100)), t });
        rows.push(cols.map((c) => { if (!c.f) return c.junk![1](); const x = v[c.f]; return textNums && typeof x === "number" && c.f !== "barcode" ? String(x).replace(".", ",") : x; }));
      }
      if (rnd() < 0.3) rows.push(cols.map((c) => (c.f === "productName" ? "TOTAL" : c.f === "lineTotal" ? 999 : null)));
      const res = smartColumns(rows, parseMoney);
      if (!isUsableMapping(res.mapping)) { manual++; continue; }
      const lines = toLines(rows, res.headerRowIndex, res.mapping);
      const ok = lines.length === n && lines.every((l, i) => l.barcode === truth[i].bc && l.productName === truth[i].name && l.quantity === truth[i].q
        && Math.abs((l.cost ?? NaN) - truth[i].cost) < 0.011 && Math.abs((l.lineTotal ?? NaN) - truth[i].t) < 0.011);
      if (ok) essentialOk++;
    }
    expect(manual).toBe(0);
    expect(essentialOk).toBe(N);
  });
});

describe("Rendimiento", () => {
  it("40 columnas × 500 filas en menos de medio segundo", () => {
    const rows: unknown[][] = [Array.from({ length: 40 }, (_, j) => "Col" + j)];
    for (let i = 0; i < 500; i++) rows.push(Array.from({ length: 40 }, (_, j) => (j === 0 ? "8412345678905" : j === 1 ? "PRODUCTO " + i : j === 2 ? 1 + (i % 12) : j === 3 ? 1.5 : j === 4 ? (1 + (i % 12)) * 1.5 : (i * 7 + j * 13) % 1000 / 10)));
    const t0 = performance.now();
    const res = smartColumns(rows, parseMoney);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(res.mapping).toMatchObject({ barcode: 0, productName: 1, quantity: 2, unitPrice: 3, lineTotal: 4 });
  });
});
