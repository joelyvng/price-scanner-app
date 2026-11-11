/**
 * Corrige columnas desplazadas en las líneas que devuelve la IA al leer un albarán (foto o PDF).
 *
 * Con una foto mala, la IA a veces no lee un valor de una columna (p. ej. una cantidad) y "rellena" con el de
 * la línea siguiente: desde ahí, toda la columna queda corrida una posición. Esta función lo detecta con la
 * aritmética de cada línea —cantidad × precio = importe y precio × (1 − descuento) = precio final— mirando
 * todas las líneas a la vez, devuelve la columna a su sitio y deduce el valor que faltaba.
 *
 * Nunca estropea una línea que ya cuadraba. Cada línea corregida lleva una nota en `_note` para que el
 * usuario la revise. Las reglas están en README.md; cualquier cambio debe seguir pasando fixColumnShift.test.ts.
 */

/** Columnas numéricas que se pueden corregir. */
export type ShiftColumn = "quantity" | "unitPrice" | "finalUnitPrice" | "lineTotal";

/** Una línea tal como la devuelve la IA (números; null o ausente si no se leyó). Puede llevar más campos. */
export interface OcrLine {
  quantity?: number | null;
  unitPrice?: number | null;
  discountPercent?: number | null;
  finalUnitPrice?: number | null;
  lineTotal?: number | null;
  [field: string]: unknown;
}

/** La misma línea; `_note` explica qué se corrigió (solo en las líneas tocadas). */
export type FixedLine<T extends OcrLine> = T & { _note?: string };

const COLUMNS: readonly ShiftColumn[] = ["quantity", "unitPrice", "finalUnitPrice", "lineTotal"];
const COLUMN_NAMES: Readonly<Record<ShiftColumn, string>> = {
  quantity: "cantidad",
  unitPrice: "precio",
  finalUnitPrice: "precio final",
  lineTotal: "importe",
};

/** Mínimo de líneas para intentar nada: con menos no hay forma de distinguir un desplazamiento. */
const MIN_LINES = 3;
/** Una hipótesis se acepta si hace cuadrar al menos 2 líneas más que la lectura original. */
const MIN_GAIN = 2;
/** Como mucho se corrigen 2 columnas (dos desplazamientos) por albarán. */
const MAX_ROUNDS = 2;

/** Número positivo y finito, o undefined. */
const positive = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/** Descuento en %, solo si está entre 0 y 100 (exclusivos); si no, 0. */
const discountOf = (line: OcrLine): number =>
  typeof line.discountPercent === "number" && line.discountPercent > 0 && line.discountPercent < 100 ? line.discountPercent : 0;

/** Precio efectivo de la línea: el final si existe; si no, precio × (1 − descuento). */
function effectivePrice(line: OcrLine): number | undefined {
  const final = positive(line.finalUnitPrice);
  if (final !== undefined) return final;
  const unit = positive(line.unitPrice);
  if (unit === undefined) return undefined;
  return unit * (1 - discountOf(line) / 100);
}

/**
 * ¿La línea cuadra?
 *  - cantidad × precio efectivo = importe (tolerancia: 2 céntimos o 1 %), y
 *  - si hay precio y precio final: precio × (1 − descuento) = precio final (1,1 céntimos o 1 %).
 */
export function lineIsConsistent(line: OcrLine): boolean {
  const q = positive(line.quantity), p = effectivePrice(line), t = positive(line.lineTotal);
  if (q === undefined || p === undefined || t === undefined || Math.abs(q * p - t) > Math.max(0.02, 0.01 * t)) return false;
  const u = positive(line.unitPrice), f = positive(line.finalUnitPrice);
  return u === undefined || f === undefined || Math.abs(u * (1 - discountOf(line) / 100) - f) <= Math.max(0.011, 0.01 * f);
}

/** Deduce el valor que falta en la columna `col` a partir de las otras. undefined si no se puede. */
function deduce(line: OcrLine, col: ShiftColumn): number | undefined {
  const q = positive(line.quantity), p = effectivePrice({ ...line, [col]: undefined }), t = positive(line.lineTotal);
  if (col === "quantity" && p && t) {
    const v = t / p; // la cantidad tiene que salir entera
    return Math.abs(v - Math.round(v)) <= 0.02 && Math.round(v) > 0 ? Math.round(v) : undefined;
  }
  if (col === "lineTotal" && q && p) return Math.round(q * p * 100) / 100;
  const final = positive(line.finalUnitPrice);
  if (col === "unitPrice" && final !== undefined) return Math.round((final / (1 - discountOf(line) / 100)) * 10000) / 10000;
  if ((col === "finalUnitPrice" || col === "unitPrice") && q && t) return Math.round((t / q) * 10000) / 10000;
  return undefined;
}

interface Hypothesis {
  gain: number;
  col: ShiftColumn;
  /** Primera línea afectada. */
  from: number;
  /** 1: se perdió un valor en `from` y los de debajo subieron → se bajan. -1: se coló un valor → se suben. */
  dir: 1 | -1;
  candidate: OcrLine[];
  /** Línea que queda sin valor tras recolocar (`from` si dir = 1, la última si dir = -1). */
  gap: number;
  filled: number | undefined;
}

export function fixColumnShift<T extends OcrLine>(lines: readonly T[]): FixedLine<T>[] {
  const n = lines.length;
  if (n < MIN_LINES) return lines as FixedLine<T>[];
  let rows: OcrLine[] = lines.map((l) => ({ ...l }));
  const notes: string[][] = rows.map(() => []);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const before = rows.map(lineIsConsistent);
    const beforeCount = before.filter(Boolean).length;
    let best: Hypothesis | null = null;

    for (const col of COLUMNS) {
      if (rows.filter((r) => positive(r[col]) !== undefined).length < 2) continue;
      for (let from = 0; from < n - 1; from++) {
        for (const dir of [1, -1] as const) {
          const candidate = rows.map((r) => ({ ...r }));
          const gap = dir === 1 ? from : n - 1;
          for (let i = from; i < n; i++) {
            candidate[i][col] = dir === 1 ? (i === from ? undefined : rows[i - 1][col]) : i === n - 1 ? undefined : rows[i + 1][col];
          }
          const filled = deduce(candidate[gap], col);
          if (filled !== undefined) candidate[gap][col] = filled;
          const after = candidate.map(lineIsConsistent);
          if (before.some((ok, i) => ok && !after[i])) continue; // nunca estropear una línea que ya cuadraba
          const gain = after.filter(Boolean).length - beforeCount;
          if (gain >= MIN_GAIN && (!best || gain > best.gain)) best = { gain, col, from, dir, candidate, gap, filled };
        }
      }
    }

    if (!best) break;
    for (let i = best.from; i < n; i++) {
      if (rows[i][best.col] !== best.candidate[i][best.col]) {
        notes[i].push(`Columna «${COLUMN_NAMES[best.col]}» desplazada en la lectura: corregida automáticamente, revísala`);
      }
    }
    if (best.filled !== undefined) notes[best.gap].push(`«${COLUMN_NAMES[best.col]}» no se leyó: deducido de las otras columnas, revísalo`);
    rows = best.candidate;
  }

  return rows.map((r, i) => (notes[i].length ? { ...r, _note: [...new Set(notes[i])].join(" · ") } : r)) as FixedLine<T>[];
}
