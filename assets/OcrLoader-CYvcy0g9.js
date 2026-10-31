import{n as I}from"./money-DCffKcry.js";import{v as R}from"./ReviewSave-CBSdTEXr.js";import{b as j,p as T,a as x}from"./parse-Dxw5zKw3.js";import{u as A,j as v}from"./index-CNce8Phb.js";
// Corrige columnas desplazadas en las líneas devueltas por la IA (valores numéricos).
// Hipótesis: en una columna se perdió (o se coló) un valor en la línea k y los siguientes se corrieron una posición.
function fixColumnShift(lines) {
  const COLS = ["quantity", "unitPrice", "finalUnitPrice", "lineTotal"];
  const NAMES = { quantity: "cantidad", unitPrice: "precio", finalUnitPrice: "precio final", lineTotal: "importe" };
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
  const n = lines.length;
  if (n < 3) return lines;
  let rows = lines.map((l) => ({ ...l }));
  const price = (r) => { const f = num(r.finalUnitPrice); if (f !== undefined) return f; const u = num(r.unitPrice); if (u === undefined) return undefined; const d = typeof r.discountPercent === "number" && r.discountPercent > 0 && r.discountPercent < 100 ? r.discountPercent : 0; return u * (1 - d / 100); };
  const disc = (r) => (typeof r.discountPercent === "number" && r.discountPercent > 0 && r.discountPercent < 100 ? r.discountPercent : 0);
  const ok = (r) => {
    const q = num(r.quantity), p = price(r), t = num(r.lineTotal);
    if (q === undefined || p === undefined || t === undefined || Math.abs(q * p - t) > Math.max(0.02, 0.01 * t)) return false;
    const u = num(r.unitPrice), f = num(r.finalUnitPrice);   // si hay precio y precio final, también deben cuadrar entre sí
    return u === undefined || f === undefined || Math.abs(u * (1 - disc(r) / 100) - f) <= Math.max(0.011, 0.01 * f);
  };
  // ¿Se puede deducir el valor que falta en la columna c de la fila r?
  const deduce = (r, c) => {
    const q = num(r.quantity), p = price({ ...r, [c]: undefined }), t = num(r.lineTotal);
    if (c === "quantity" && p && t) { const v = t / p; return Math.abs(v - Math.round(v)) <= 0.02 && Math.round(v) > 0 ? Math.round(v) : undefined; }
    if (c === "lineTotal" && q && p) return Math.round(q * p * 100) / 100;
    if (c === "unitPrice" && num(r.finalUnitPrice) !== undefined) return Math.round((num(r.finalUnitPrice) / (1 - disc(r) / 100)) * 10000) / 10000;
    if ((c === "finalUnitPrice" || c === "unitPrice") && q && t) return Math.round((t / q) * 10000) / 10000;
    return undefined;
  };
  const notes = rows.map(() => []);
  for (let round = 0; round < 2; round++) {
    const base = rows.map(ok), baseCount = base.filter(Boolean).length;
    let best = null;
    for (const c of COLS) {
      if (rows.filter((r) => num(r[c]) !== undefined).length < 2) continue;
      for (let k = 0; k < n - 1; k++) for (const dir of [1, -1]) {
        const cand = rows.map((r) => ({ ...r })), gap = dir === 1 ? k : n - 1;
        for (let i = k; i < n; i++) cand[i][c] = dir === 1 ? (i === k ? undefined : rows[i - 1][c]) : (i === n - 1 ? undefined : rows[i + 1][c]);
        const filled = deduce(cand[gap], c); if (filled !== undefined) cand[gap][c] = filled;
        const after = cand.map(ok);
        if (base.some((b, i) => b && !after[i])) continue;           // nunca estropear una línea que ya cuadraba
        const gain = after.filter(Boolean).length - baseCount;
        if (gain >= 2 && (!best || gain > best.gain)) best = { gain, c, k, dir, cand, gap, filled };
      }
    }
    if (!best) break;
    for (let i = best.k; i < n; i++) if (rows[i][best.c] !== best.cand[i][best.c]) notes[i].push(`Columna «${NAMES[best.c]}» desplazada en la lectura: corregida automáticamente, revísala`);
    if (best.filled !== undefined) notes[best.gap].push(`«${NAMES[best.c]}» no se leyó: deducido de las otras columnas, revísalo`);
    rows = best.cand;
  }
  return rows.map((r, i) => (notes[i].length ? { ...r, _note: [...new Set(notes[i])].join(" · ") } : r));
}
const S=[1,10,100,1e3];function U(e){return String(Math.round(e*1e4)/1e4).replace(".",",")}function q(e){const a=j(e.quantity),o=T(e.lineTotal),s=x(e.discountPercent)??0,i=T(e.finalUnitPrice),c=T(e.unitPrice);if(a===void 0||a<=0||o===void 0||o<=0)return null;const t=o/a,n=i??c;if(n===void 0||n<=0)return null;const l=d=>Math.abs(d-t)/t,h=i!==void 0;let u=1,p=1/0;for(const d of S){const b=h?n/d:n/d*(1-s/100),y=l(b);y<p&&(p=y,u=d)}const P=l(h?n:n*(1-s/100));return u===1||p>.03||P<.15?null:{unitPrice:c!==void 0?U(c/u):e.unitPrice,finalUnitPrice:i!==void 0?U(i/u):e.finalUnitPrice}}async function k(e,a,o){return g(e,{image:a},o)}async function z(e,a,o){return g(e,{pdf:a},o)}async function F(e,a,o){return g(e,{text:a},o)}async function g(e,a,o){var P,d,b,y,w,C,N,O;let s;const i=new AbortController,c=setTimeout(()=>i.abort(),6e4);try{s=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json","x-admin-key":o},body:JSON.stringify(a),signal:i.signal})}catch{throw new Error("No se pudo conectar con el servicio de OCR con IA. ¿La URL es correcta y tienes conexión?")}finally{clearTimeout(c)}let t;try{t=await s.json()}catch{throw new Error("El servicio de OCR con IA devolvió una respuesta no válida.")}if(!s.ok)throw Object.assign(new Error(t!=null&&t.error?`OCR con IA: ${t.error}`:`OCR con IA: error ${s.status}`),{status:s.status});const n=r=>r==null?"":String(r),l=r=>typeof r=="number"&&Number.isFinite(r)?String(r).replace(".",","):"",h=fixColumnShift(Array.isArray(t.lines)?t.lines:[]).map(r=>{const f={quantity:l(r.quantity),unitPrice:l(r.unitPrice),discountPercent:l(r.discountPercent),finalUnitPrice:l(r.finalUnitPrice),lineTotal:l(r.lineTotal)},m=q(f);const o2=R({key:I(),reference:n(r.reference),barcode:n(r.barcode),productName:n(r.productName),quantity:f.quantity,unitPrice:(m==null?void 0:m.unitPrice)??f.unitPrice,discountPercent:f.discountPercent,finalUnitPrice:(m==null?void 0:m.finalUnitPrice)??f.finalUnitPrice,lineTotal:f.lineTotal,issues:[]});return r._note&&o2.issues.push(r._note),o2}),u={supplier:n((P=t.header)==null?void 0:P.supplier)||void 0,deliveryNumber:n((d=t.header)==null?void 0:d.deliveryNumber)||void 0,customerCode:n((b=t.header)==null?void 0:b.customerCode)||void 0,date:/^\d{4}-\d{2}-\d{2}$/.test(n((y=t.header)==null?void 0:y.date))?n((w=t.header)==null?void 0:w.date):void 0},p={subtotal:typeof((C=t.totals)==null?void 0:C.subtotal)=="number"?t.totals.subtotal:void 0,discountTotal:typeof((N=t.totals)==null?void 0:N.discountTotal)=="number"?t.totals.discountTotal:void 0,grandTotal:typeof((O=t.totals)==null?void 0:O.grandTotal)=="number"?t.totals.grandTotal:void 0};return{header:u,totals:p,lines:h}}function W({label:e}){const a=A(),o=e??a("Leyendo albarán"),s=Array.from(o);return v.jsxs("div",{className:"loader-wrapper",role:"status","aria-label":o,children:[v.jsx("div",{className:"loader","aria-hidden":"true"}),v.jsx("div",{className:"loader-word","aria-hidden":"true",children:s.map((i,c)=>v.jsx("span",{className:"loader-letter",style:{animationDelay:`${c*.1}s`},children:i},`${i}-${c}`))})]})}export{W as O,F as a,z as b,k as r};
