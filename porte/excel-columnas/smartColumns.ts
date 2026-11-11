/**
 * Detección automática de columnas en un Excel de albarán.
 *
 * Combina dos pistas:
 *   1. El texto de las cabeceras, de forma flexible (español, inglés y chino).
 *   2. El contenido de cada columna: códigos de barras por su dígito de control, y
 *      cantidad / precio / descuento / importe por la cuenta
 *      cantidad × precio × (1 − descuento / 100) = importe.
 *
 * Funciona también sin fila de cabeceras y con la cabecera más abajo (filas de
 * membrete encima). Devuelve lo mismo que la función de detección original de la app,
 * así que la pantalla de importación no cambia: si el resultado tiene código de barras
 * y algún precio, se pasa directo a la revisión; si no, la pantalla manual sale
 * prerrellenada con este resultado.
 *
 * Las reglas están explicadas en README.md. Cualquier cambio aquí debe seguir pasando
 * smartColumns.test.ts.
 */

export type ColumnField =
  | "barcode"
  | "reference"
  | "productName"
  | "quantity"
  | "unitPrice"
  | "discountPercent"
  | "finalUnitPrice"
  | "lineTotal";

/** Campo → índice de columna (0 = primera columna). */
export type ColumnMapping = Partial<Record<ColumnField, number>>;

export interface DetectionResult {
  /** Índice de la fila de cabeceras; los datos empiezan en la siguiente. -1 = sin cabecera, datos desde la fila 0. */
  headerRowIndex: number;
  mapping: ColumnMapping;
  /** Textos de la fila de cabeceras ([] si no hay). */
  headers: string[];
}

/** Una fila tal como la devuelve `XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null, blankrows: false })`. */
export type Row = ReadonlyArray<unknown> | null | undefined;

/** Convierte un texto de importe ("1.234,56", "12,50 €"…) en número. En la app es el parser de importes (parse.ts). */
export type ParseNumber = (value: unknown) => number | undefined;

/**
 * Lista de cabeceras exactas que ya reconocía la app (constante `S` del servicio de inventario).
 * Se mantiene para que los Excel que ya se importaban bien se sigan detectando igual.
 */
export const EXACT_HEADERS_ALBARAN: Readonly<Record<ColumnField, readonly string[]>> = {
  barcode: ["cod.barra", "cod barra", "codbarra", "codigo barra", "codigo de barras", "cod. barra", "ean", "ean13", "ean 13", "gtin", "barcode", "codigo barras"],
  reference: ["referencia", "ref", "ref.", "cod.art", "cod art", "codart", "sku", "articulo id"],
  productName: ["articulo", "descripcion", "producto", "nombre", "denominacion"],
  quantity: ["cantid", "cantidad", "cant.", "cant", "qty", "unidades", "uds"],
  unitPrice: ["pre/u", "precio/u", "precio unitario", "p.unitario", "p. unit", "p.unit", "unit price", "precio"],
  discountPercent: ["dto", "dto%", "dto %", "descuento", "descuento %", "discount"],
  finalUnitPrice: ["pre.f", "pre f", "pref", "precio final", "precio neto", "net price", "coste neto"],
  lineTotal: ["importe", "total", "total linea", "subtotal"],
};

// ---------------------------------------------------------------------------
// Límites (ver README, "Rendimiento")
// ---------------------------------------------------------------------------
const MAX_HEADER_SCAN_ROWS = 20; // la cabecera se busca en las 20 primeras filas
const MAX_DATA_ROWS = 300; // filas que se analizan para el contenido
const MAX_ARITH_ROWS = 80; // filas usadas en la búsqueda aritmética
const MAX_NUMERIC_COLUMNS = 12; // columnas numéricas que entran en la búsqueda aritmética

// Umbrales
const MIN_BARCODE_SHARE = 0.5; // ≥ 50 % de códigos válidos para considerar una columna "código de barras"
const MIN_NUMERIC_SHARE = 0.6; // ≥ 60 % de números para considerar una columna "numérica"
const MIN_ARITH_SUPPORT = 0.6; // la combinación cantidad × precio = importe debe cuadrar en ≥ 60 % de las filas
const MIN_GROSS_SUPPORT = 0.8; // bruto × (1 − dto) = neto en ≥ 80 % de las filas
const MIN_TEXT_SHARE_HEADER = 0.5; // la columna que la cabecera llama "nombre" debe ser ≥ 50 % texto
const MIN_TEXT_SHARE_GUESS = 0.6; // sin cabecera, el nombre es la columna de texto (≥ 60 %) más larga

// ---------------------------------------------------------------------------
// Cabeceras
// ---------------------------------------------------------------------------

/** Minúsculas, sin acentos, puntuación → espacio, espacios colapsados. Los caracteres chinos se conservan. */
export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_\-./:()·,;'"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "code" = cabecera ambigua ("Código"): puede ser código de barras o referencia, lo decide el contenido. */
type HeaderHint = ColumnField | "code";

/**
 * Qué campo sugiere el texto de una cabecera. El orden importa: se prueba de arriba abajo
 * y gana la primera regla que encaja (p. ej. "Importe neto" es importe, no precio neto).
 */
export function headerField(raw: unknown, exactLists: Readonly<Record<string, readonly string[]>> = EXACT_HEADERS_ALBARAN): HeaderHint | null {
  const s = normalizeHeader(raw);
  if (!s) return null;
  for (const [field, list] of Object.entries(exactLists)) {
    if (list.some((x) => normalizeHeader(x) === s)) return field as ColumnField;
  }
  if (/(^| )(ean ?13|ean ?8|ean|gtin|upc|barcode|bar ?code|c ?b)( |$)|cod(igo)?( de)? barras?|条码|条形码|国际码|商品码/.test(s)) return "barcode";
  if (/(^| )(ref|referencia|sku|cod ?art|codart|modelo|art)( |$)|codigo (interno|art|articulo|prov|proveedor)|articulo id|货号|编号|编码|型号|款号/.test(s)) return "reference";
  if (/descrip|concepto|denomin|nombre|detalle|(^| )(articulo|producto|product|item|name|description)( |$)|名称|品名|商品|货品|产品/.test(s)) return "productName";
  if (/(^| )(dto|dtos|desc|descuento|discount|rebaja)( |%|$)|折扣/.test(s)) return "discountPercent";
  if (/(^| )(importe|total|subtotal|amount|valor)( |$)|金额|总价|小计|合计|总额/.test(s)) return "lineTotal";
  if (
    /(neto|final|net)( |$)|(^| )pre ?f( |$)|(^| )pref( |$)|折后|净价|实价/.test(s) &&
    /prec|pre|precio|price|p |coste|costo|neto|net|final|价/.test(s)
  ) return "finalUnitPrice";
  if (/prec|precio|(^| )pvp|(^| )p ?u( |$)|unit|price|tarifa|coste|costo|单价|价格|进价/.test(s)) return "unitPrice";
  if (/(^| )(cant|cantid|cantidad|uds|ud|u|unid|unidades|qty|quantity|pcs|piezas|bultos|cajas)( |$)|数量|件数|个数/.test(s)) return "quantity";
  if (/(^| )(codigo|cod|code)( |$)|代码/.test(s)) return "code";
  return null;
}

type HeaderMap = Partial<Record<HeaderHint, number>>;

/** Fila de cabeceras: la de las primeras 20 que reconoce más campos (código, precio e importe valen doble). Mínimo 2 campos. */
function findHeaderRow(rows: readonly Row[], exactLists: Readonly<Record<string, readonly string[]>>): { index: number; hints: HeaderMap } {
  let index = -1;
  let hints: HeaderMap = {};
  let best = 0;
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
    const row = rows[i] ?? [];
    const found: HeaderMap = {};
    let score = 0;
    row.forEach((cell, col) => {
      const field = headerField(cell, exactLists);
      if (field && found[field] === undefined) {
        found[field] = col;
        score += field === "barcode" || field === "unitPrice" || field === "lineTotal" ? 2 : 1;
      }
    });
    if (Object.keys(found).length >= 2 && score > best) {
      best = score;
      index = i;
      hints = found;
    }
  }
  return { index, hints };
}

// ---------------------------------------------------------------------------
// Contenido
// ---------------------------------------------------------------------------

/** GTIN válido: 8, 12, 13 o 14 dígitos con dígito de control correcto. Acepta número o texto. */
export function isGtin(value: unknown): boolean {
  const s = typeof value === "number" ? (Number.isInteger(value) ? String(value) : "") : String(value ?? "").replace(/\s/g, "");
  if (!/^(\d{8}|\d{12,14})$/.test(s)) return false;
  const digits = s.split("").map(Number);
  const check = digits.pop() as number;
  let total = 0;
  digits.reverse().forEach((d, i) => (total += d * (i % 2 === 0 ? 3 : 1)));
  return (10 - (total % 10)) % 10 === check;
}

const isFilled = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== "";

interface ColumnStats {
  /** Celdas con valor. */
  count: number;
  /** Proporción de códigos de barras válidos. */
  gtinShare: number;
  /** Proporción de números. */
  numericShare: number;
  /** De los números, proporción de enteros. */
  integerShare: number;
  /** Proporción de textos que no son números. */
  textShare: number;
  /** Longitud media del texto de la celda. */
  avgLength: number;
}

function columnStats(data: readonly ReadonlyArray<unknown>[], col: number, toNumber: (v: unknown) => number | undefined): ColumnStats {
  const vals = data.map((r) => r[col]).filter(isFilled);
  const nums = vals.map(toNumber).filter((x): x is number => x !== undefined);
  const n = vals.length;
  return {
    count: n,
    gtinShare: n ? vals.filter(isGtin).length / n : 0,
    numericShare: n ? nums.length / n : 0,
    integerShare: nums.length ? nums.filter((x) => Number.isInteger(x)).length / nums.length : 0,
    textShare: n ? vals.filter((v) => typeof v === "string" && toNumber(v) === undefined).length / n : 0,
    avgLength: n ? vals.reduce<number>((a, v) => a + String(v).length, 0) / n : 0,
  };
}

/** ¿Cuadra a × b ≈ c? Tolerancia: 2 céntimos o 1 %. */
const lineMatches = (expected: number, actual: number): boolean => Math.abs(expected - actual) <= Math.max(0.02, 0.01 * actual);
/** ¿Cuadra un precio? Tolerancia: 1,1 céntimos o 1 %. */
const priceMatches = (expected: number, actual: number): boolean => Math.abs(expected - actual) <= Math.max(0.011, 0.01 * actual);

// ---------------------------------------------------------------------------
// Detección
// ---------------------------------------------------------------------------

export function smartColumns(
  rows: readonly Row[],
  parseNum: ParseNumber,
  exactLists: Readonly<Record<string, readonly string[]>> = EXACT_HEADERS_ALBARAN,
): DetectionResult {
  const toNumber = (v: unknown): number | undefined => (typeof v === "number" ? (Number.isFinite(v) ? v : undefined) : parseNum(v));
  const width = Math.max(0, ...rows.slice(0, MAX_DATA_ROWS).map((r) => (r ? r.length : 0)));

  // 1) Fila de cabeceras
  const header = findHeaderRow(rows, exactLists);
  let headerRowIndex = header.index;
  const hints = header.hints;

  // 2) Contenido: filas de datos con al menos 2 celdas rellenas
  const data = rows
    .slice(headerRowIndex + 1, headerRowIndex + 1 + MAX_DATA_ROWS)
    .filter((r): r is ReadonlyArray<unknown> => !!r && r.filter(isFilled).length >= 2);
  const stats = Array.from({ length: width }, (_, col) => columnStats(data, col, toNumber));

  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const take = (field: ColumnField, col: number | undefined): boolean => {
    if (col === undefined || col < 0 || used.has(col)) return false;
    mapping[field] = col;
    used.add(col);
    return true;
  };

  // 3) Código de barras: la cabecera si el contenido no la contradice; si no, la columna con más códigos válidos
  const barcodeCandidates = stats
    .map((s, col) => [col, s.gtinShare] as const)
    .filter(([, share]) => share >= MIN_BARCODE_SHARE)
    .sort((a, b) => b[1] - a[1]);
  const hintedBarcode = hints.barcode ?? hints.code;
  if (hintedBarcode !== undefined && ((stats[hintedBarcode]?.gtinShare ?? 0) >= MIN_BARCODE_SHARE || (!barcodeCandidates.length && data.length === 0))) {
    take("barcode", hintedBarcode);
  } else if (barcodeCandidates.length) {
    take("barcode", barcodeCandidates[0][0]);
  }

  // 4) Cantidad / precio / descuento / importe por aritmética
  const hintedNumeric = new Set(
    (["quantity", "unitPrice", "finalUnitPrice", "discountPercent", "lineTotal"] as const).map((f) => hints[f]).filter((c): c is number => c !== undefined),
  );
  const numericCols = stats
    .map((_, col) => col)
    .filter((col) => !used.has(col) && stats[col].numericShare >= MIN_NUMERIC_SHARE && stats[col].gtinShare < MIN_BARCODE_SHARE)
    .sort((a, b) => Number(hintedNumeric.has(b)) - Number(hintedNumeric.has(a)) || stats[b].numericShare - stats[a].numericShare || a - b)
    .slice(0, MAX_NUMERIC_COLUMNS)
    .sort((a, b) => a - b);
  const sample = data.slice(0, MAX_ARITH_ROWS);
  const cell = (row: ReadonlyArray<unknown>, col: number | undefined): number | undefined => (col === undefined ? undefined : toNumber(row[col]));

  /** Proporción de filas en que cantidad(q) × precio(p) × (1 − dto(d)) = importe(t). */
  const support = (q: number, p: number, t: number, d: number | undefined): number => {
    let ok = 0;
    let n = 0;
    for (const r of sample) {
      const Q = cell(r, q), P = cell(r, p), T = cell(r, t);
      const D = d === undefined ? 0 : cell(r, d) ?? 0;
      if (Q === undefined || P === undefined || T === undefined || !(Q > 0 && P > 0 && T > 0)) continue;
      n++;
      if (D < 0 || D >= 100) continue;
      if (lineMatches(Q * P * (1 - D / 100), T)) ok++;
    }
    return n >= 2 ? ok / n : 0;
  };

  let best: { q: number; p: number; t: number; d: number | undefined; score: number } | null = null;
  for (const q of numericCols) for (const p of numericCols) for (const t of numericCols) {
    if (q === p || p === t || q === t) continue;
    for (const d of [undefined, ...numericCols.filter((x) => x !== q && x !== p && x !== t)]) {
      const s = support(q, p, t, d);
      if (s < MIN_ARITH_SUPPORT) continue;
      // Desempate: coincidir con las cabeceras, no usar descuento si no hace falta y cantidades enteras
      const agree =
        Number(hints.quantity === q) +
        Number(hints.lineTotal === t) +
        Number(hints.unitPrice === p || hints.finalUnitPrice === p) +
        Number(d !== undefined && hints.discountPercent === d);
      const score = s * 10 + agree + (d === undefined ? 0.5 : 0) + stats[q].integerShare;
      if (!best || score > best.score) best = { q, p, t, d, score };
    }
  }

  if (best) {
    take("quantity", best.q);
    take("lineTotal", best.t);
    const priceIsFinalByHeader = hints.finalUnitPrice === best.p;

    // ¿El precio que cuadra es en realidad el neto? Busca un bruto U y un descuento D con U × (1 − D) = ese precio.
    let gross: { u: number; d: number; share: number } | null = null;
    if (best.d === undefined) {
      for (const u of numericCols) {
        if (used.has(u) || u === best.p) continue;
        for (const d of numericCols) {
          if (used.has(d) || d === u || d === best.p) continue;
          let ok = 0, n = 0, nonZero = 0;
          for (const r of sample) {
            const U = cell(r, u), D = cell(r, d) ?? 0, F = cell(r, best.p);
            if (!(U !== undefined && U > 0 && F !== undefined && F > 0) || D < 0 || D >= 100) continue;
            n++;
            if (priceMatches(U * (1 - D / 100), F)) {
              ok++;
              if (D > 0) nonZero++;
            }
          }
          if (n >= 2 && ok / n >= MIN_GROSS_SUPPORT && nonZero >= 1 && (!gross || ok / n > gross.share)) gross = { u, d, share: ok / n };
        }
      }
    }

    if (best.d !== undefined) {
      take("unitPrice", best.p);
      take("discountPercent", best.d);
    } else if (gross) {
      take("finalUnitPrice", best.p);
      take("unitPrice", gross.u);
      take("discountPercent", gross.d);
    } else if (priceIsFinalByHeader) {
      take("finalUnitPrice", best.p);
    } else {
      take("unitPrice", best.p);
    }

    // Precio final en otra columna: precio × (1 − dto) = final y cantidad × final = importe
    if (mapping.finalUnitPrice === undefined) {
      for (const f of numericCols) {
        if (used.has(f)) continue;
        let ok = 0, n = 0;
        for (const r of data) {
          const Q = cell(r, mapping.quantity), P = cell(r, mapping.unitPrice), F = cell(r, f), T = cell(r, mapping.lineTotal);
          const D = cell(r, mapping.discountPercent) ?? 0;
          if (F === undefined || !(F > 0)) continue;
          n++;
          const priceOk = P !== undefined && priceMatches(P * (1 - D / 100), F);
          const lineOk = Q === undefined || T === undefined || lineMatches(Q * F, T);
          if (priceOk && lineOk) ok++;
        }
        if (n >= 2 && ok / n >= MIN_ARITH_SUPPORT && (hints.finalUnitPrice === f || best.d !== undefined)) {
          take("finalUnitPrice", f);
          break;
        }
      }
    }
  } else {
    // Sin aritmética que cuadre (o sin datos): se fía de las cabeceras, si la columna es numérica
    for (const f of ["quantity", "unitPrice", "finalUnitPrice", "discountPercent", "lineTotal"] as const) {
      const col = hints[f];
      if (col !== undefined && (data.length === 0 || (stats[col]?.numericShare ?? 0) >= 0.5)) take(f, col);
    }
  }

  // 5) Nombre: la cabecera si la columna es texto; si no, la columna de texto más larga
  if (hints.productName !== undefined && (data.length === 0 || (stats[hints.productName]?.textShare ?? 0) >= MIN_TEXT_SHARE_HEADER)) {
    take("productName", hints.productName);
  }
  if (mapping.productName === undefined) {
    const guess = stats
      .map((s, col) => [col, s] as const)
      .filter(([col, s]) => !used.has(col) && s.textShare >= MIN_TEXT_SHARE_GUESS)
      .sort((a, b) => b[1].avgLength - a[1].avgLength)[0];
    if (guess) take("productName", guess[0]);
  }

  // Referencia: solo por cabecera ("Ref", "SKU"… o un "Código" que no resultó ser el de barras)
  const hintedReference = hints.reference ?? (hints.code !== undefined && mapping.barcode !== hints.code ? hints.code : undefined);
  if (hintedReference !== undefined) take("reference", hintedReference);

  // 6) Sin cabecera: los datos empiezan en la primera fila que tiene un código de barras válido
  if (headerRowIndex < 0 && mapping.barcode !== undefined) {
    const barcodeCol = mapping.barcode;
    const first = rows.findIndex((r) => !!r && isGtin(r[barcodeCol]));
    headerRowIndex = first > 0 ? first - 1 : -1;
  }

  const headers = headerRowIndex >= 0 ? (rows[headerRowIndex] ?? []).map((c) => String(c ?? "").trim()) : [];
  return { headerRowIndex, mapping, headers };
}

/** Lo mínimo para importar sin pasar por la pantalla manual: código de barras y algún precio (como en la app). */
export function isUsableMapping(mapping: ColumnMapping): boolean {
  return mapping.barcode !== undefined && (mapping.finalUnitPrice !== undefined || mapping.unitPrice !== undefined);
}

/**
 * Filas de totales del albarán ("TOTAL", "Subtotal", "Base imponible", "IVA", "合计"…). Al convertir filas en
 * líneas, una fila SIN código de barras cuyo nombre sea uno de estos se descarta: no es un producto.
 */
export function isSummaryRowName(name: string): boolean {
  return /^\s*(total|subtotal|suma|base imponible|iva|importe total|total albar[aá]n)(\b|$)|^\s*(合计|总计|小计)/i.test(name);
}
