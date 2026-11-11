/**
 * Tests de la corrección de columnas desplazadas (Vitest).
 *
 *   npx vitest run fixColumnShift.test.ts
 *
 * Los escenarios con nombre están en ./escenarios.json (el primero es el caso que describió el usuario).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type OcrLine, type ShiftColumn, fixColumnShift, lineIsConsistent } from "./fixColumnShift";

const HERE = dirname(fileURLToPath(import.meta.url));
const COLS: ShiftColumn[] = ["quantity", "unitPrice", "finalUnitPrice", "lineTotal"];
const sameValues = (a: OcrLine, b: OcrLine) => COLS.every((c) => Math.abs((a[c] ?? 0) - (b[c] ?? 0)) < 0.011);

interface Scenario { descripcion: string; ia: OcrLine[]; correcto?: OcrLine[]; correctoSalvoUltima?: OcrLine[]; lineasConNota: number[] }
const scenarios: Record<string, Scenario> = JSON.parse(readFileSync(join(HERE, "escenarios.json"), "utf8"));

describe("Escenarios (escenarios.json)", () => {
  for (const [name, s] of Object.entries(scenarios)) {
    it(`${name}: ${s.descripcion}`, () => {
      const out = fixColumnShift(s.ia);
      const ref = s.correcto ?? s.correctoSalvoUltima!;
      const upTo = s.correcto ? out.length : out.length - 1; // con un valor colado, el de la última línea se perdió de verdad
      out.slice(0, upTo).forEach((line, i) => expect(sameValues(line, ref[i]), `línea ${i}`).toBe(true));
      expect(out.map((l, i) => (l._note ? i : -1)).filter((i) => i >= 0)).toEqual(s.lineasConNota);
    });
  }

  it("ejemplo del usuario: cantidades 12 · 6 · 4 · 10 · 36 · — → 12 · 6 · 24 · 4 · 10 · 36, con las notas correctas", () => {
    const out = fixColumnShift(scenarios["ejemplo-usuario"].ia);
    expect(out.map((l) => l.quantity)).toEqual([12, 6, 24, 4, 10, 36]);
    expect(out[2]._note).toBe(
      "Columna «cantidad» desplazada en la lectura: corregida automáticamente, revísala · «cantidad» no se leyó: deducido de las otras columnas, revísalo",
    );
    expect(out[3]._note).toBe("Columna «cantidad» desplazada en la lectura: corregida automáticamente, revísala");
    expect(out[0]._note).toBeUndefined();
  });
});

describe("Comportamiento básico", () => {
  const ok = (name: string, q: number, p: number): OcrLine => ({ productName: name, barcode: "8412345678905", quantity: q, unitPrice: p, finalUnitPrice: p, lineTotal: Math.round(q * p * 100) / 100 });

  it("con menos de 3 líneas no toca nada", () => {
    const two = [ok("A", 2, 1), { ...ok("B", 3, 2), quantity: 9 }];
    expect(fixColumnShift(two)).toBe(two);
  });
  it("conserva el resto de campos de cada línea (nombre, código…)", () => {
    const out = fixColumnShift(scenarios["ejemplo-usuario"].ia);
    expect(out.map((l) => l.productName)).toEqual(["TAZA", "VASO", "PLATO", "JARRA", "CESTA", "VELA"]);
  });
  it("no modifica el array de entrada", () => {
    const input = JSON.parse(JSON.stringify(scenarios["ejemplo-usuario"].ia));
    const copy = JSON.parse(JSON.stringify(input));
    fixColumnShift(input);
    expect(input).toEqual(copy);
  });
  it("lineIsConsistent: cantidad × precio = importe, y precio × (1 − dto) = final", () => {
    expect(lineIsConsistent({ quantity: 12, unitPrice: 1.2, lineTotal: 14.4 })).toBe(true);
    expect(lineIsConsistent({ quantity: 12, unitPrice: 2, discountPercent: 10, finalUnitPrice: 1.8, lineTotal: 21.6 })).toBe(true);
    expect(lineIsConsistent({ quantity: 12, unitPrice: 2, discountPercent: 10, lineTotal: 21.6 })).toBe(true);
    expect(lineIsConsistent({ quantity: 12, unitPrice: 1.2, lineTotal: 15 })).toBe(false);
    expect(lineIsConsistent({ quantity: 12, unitPrice: 3, finalUnitPrice: 1.2, lineTotal: 14.4 })).toBe(false); // precio y final no cuadran
    expect(lineIsConsistent({ quantity: null, unitPrice: 1.2, lineTotal: 14.4 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pruebas aleatorias con semilla fija
// ---------------------------------------------------------------------------
let seed = 99;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const r2 = (x: number) => Math.round(x * 100) / 100;
function randomDoc(n: number, withFinal = true): OcrLine[] {
  return Array.from({ length: n }, () => {
    const q = pick([1, 2, 3, 4, 6, 6, 10, 12, 12, 24, 36, 48]), u = r2(0.3 + rnd() * 25), d = withFinal ? pick([0, 0, 0, 5, 10]) : 0, f = r2(u * (1 - d / 100));
    return withFinal ? { quantity: q, unitPrice: u, discountPercent: d, finalUnitPrice: f, lineTotal: r2(q * f) } : { quantity: q, unitPrice: u, discountPercent: 0, lineTotal: r2(q * u) };
  });
}
const shiftUp = (truth: OcrLine[], col: ShiftColumn, k: number) => truth.map((r, i) => (i < k ? { ...r } : { ...r, [col]: truth[i + 1] ? truth[i + 1][col] : null }));
const consistentCount = (rows: OcrLine[]) => rows.filter(lineIsConsistent).length;

describe("Aleatorio (semilla fija)", () => {
  it("5.000 lecturas correctas: nunca toca nada", () => {
    for (let k = 0; k < 5000; k++) {
      const doc = randomDoc(3 + Math.floor(rnd() * 22), rnd() < 0.7);
      const out = fixColumnShift(doc);
      expect(out.every((l, i) => COLS.every((c) => l[c] === doc[i][c]) && !l._note)).toBe(true);
    }
  });

  it("5.000 albaranes con una columna corrida: nunca peor, sin arreglos a medias; 100 % arreglados si afecta a 3 líneas o más", () => {
    let partial = 0, worse = 0, long = 0, longFixed = 0;
    for (let k = 0; k < 5000; k++) {
      const n = 3 + Math.floor(rnd() * 22), truth = randomDoc(n, rnd() < 0.7);
      const cols = COLS.filter((c) => truth.every((r) => r[c] !== undefined));
      const from = Math.floor(rnd() * n);
      const obs = shiftUp(truth, pick(cols), from);
      const out = fixColumnShift(obs);
      const rightBefore = obs.filter((r, i) => sameValues(r, truth[i])).length, rightAfter = out.filter((r, i) => sameValues(r, truth[i])).length;
      const changed = out.some((r, i) => !sameValues(r, obs[i]));
      if (rightAfter < rightBefore) worse++;
      if (changed && rightAfter !== n) partial++;
      // Si el desplazamiento afecta a 1–2 líneas (al final del albarán) puede no corregirse: hacen falta al menos
      // 2 líneas que pasen a cuadrar. Esas líneas quedan como las dejó la IA y la validación de la app las marca.
      if (n - from >= 3) { long++; if (rightAfter === n) longFixed++; }
    }
    expect(worse).toBe(0);
    expect(partial).toBe(0);
    expect(longFixed).toBe(long);
  });

  it("5.000 albaranes con un solo dígito mal leído: nunca desplaza columnas", () => {
    for (let k = 0; k < 5000; k++) {
      const n = 3 + Math.floor(rnd() * 22), doc = randomDoc(n), i = Math.floor(rnd() * n), c = pick(COLS);
      doc[i] = { ...doc[i], [c]: r2((doc[i][c] as number) * pick([10, 0.1, 1.5, 2])) || 1 };
      expect(fixColumnShift(doc).some((l) => l._note?.includes("desplazada"))).toBe(false);
    }
  });

  it("2.000 albaranes con dos columnas corridas: ≥ 95 % arreglados del todo", () => {
    let fixed = 0;
    for (let k = 0; k < 2000; k++) {
      const n = 8 + Math.floor(rnd() * 16), truth = randomDoc(n);
      const c1 = pick(["quantity", "lineTotal"] as const), c2 = pick(["unitPrice", "finalUnitPrice"] as const);
      const k1 = Math.floor(rnd() * (n / 2)), k2 = Math.floor(n / 2 + rnd() * (n / 2 - 2));
      const obs = shiftUp(shiftUp(truth, c1, k1), c2, k2);
      const out = fixColumnShift(obs);
      if (out.every((r, i) => sameValues(r, truth[i]))) fixed++;
      expect(consistentCount(out)).toBeGreaterThanOrEqual(consistentCount(obs));
    }
    expect(fixed / 2000).toBeGreaterThanOrEqual(0.95);
  });
});
