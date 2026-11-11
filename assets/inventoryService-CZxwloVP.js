import{d as u}from"./index-CNce8Phb.js";import{a as b,n as g}from"./normalize-CC31ZC5_.js";import{p as m}from"./parse-Dxw5zKw3.js";import{n as v}from"./money-DCffKcry.js";const x=15*1024*1024;async function B(e){if(e.size>x)throw new Error("El archivo es demasiado grande (máx. 15 MB).");let r,w;try{const n=await e.arrayBuffer(),{r:h,u:U}=await import("./xlsx-DLNWaC59.js");w=U;r=h(n,{type:"array",raw:!1,cellText:!0})}catch{throw new Error("No hemos podido leer el Excel. ¿Es un .xlsx o .xls válido?")}const o=r.SheetNames.map(n=>{const a=r.Sheets[n],c=w.sheet_to_json(a,{header:1,raw:!0,defval:null,blankrows:!1});return{name:n,rows:c}}).filter(n=>n.rows.length>0);if(o.length===0)throw new Error("El Excel no contiene ninguna hoja con datos.");return o}const S={barcode:["cod.barra","cod barra","codbarra","codigo barra","codigo de barras","cod. barra","ean","ean13","ean 13","gtin","barcode","codigo barras"],reference:["referencia","ref","ref.","cod.art","cod art","codart","sku","articulo id"],productName:["articulo","descripcion","producto","nombre","denominacion"],quantity:["cantid","cantidad","cant.","cant","qty","unidades","uds"],unitPrice:["pre/u","precio/u","precio unitario","p.unitario","p. unit","p.unit","unit price","precio"],discountPercent:["dto","dto%","dto %","descuento","descuento %","discount"],finalUnitPrice:["pre.f","pre f","pref","precio final","precio neto","net price","coste neto"],lineTotal:["importe","total","total linea","subtotal"]};function y(e){return b(String(e??"").replace(/[_-]+/g," ")).replace(/\s+/g," ").trim()}function M(e){return smartColumns(e,m,S)}
// Detección automática de columnas en un Excel de albarán: cabeceras flexibles (es/en/zh) + contenido.
function smartColumns(rows, parseNum, exactLists) {
  const FIELDS = ["barcode", "reference", "productName", "quantity", "unitPrice", "discountPercent", "finalUnitPrice", "lineTotal"];
  const norm = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\-./:()·,;'"]+/g, " ").replace(/\s+/g, " ").trim();
  const has = (s, re) => re.test(s);
  // Qué campo sugiere el texto de una cabecera ("code" = código ambiguo: barras o referencia, lo decide el contenido)
  const headerField = (raw) => {
    const s = norm(raw); if (!s) return null;
    for (const [f, list] of Object.entries(exactLists || {})) if (list.some((x) => norm(x) === s)) return f;
    if (has(s, /(^| )(ean ?13|ean ?8|ean|gtin|upc|barcode|bar ?code|cb)( |$)|cod(igo)?( de)? barras?|条码|条形码|国际码|商品码/)) return "barcode";
    if (has(s, /(^| )(ref|referencia|sku|cod ?art|codart|modelo|art)( |$)|codigo (interno|art|articulo|prov|proveedor)|articulo id|货号|编号|编码|型号|款号/)) return "reference";
    if (has(s, /descrip|concepto|denomin|nombre|detalle|(^| )(articulo|producto|product|item|name|description)( |$)|名称|品名|商品|货品|产品/)) return "productName";
    if (has(s, /(^| )(dto|dtos|desc|descuento|discount|rebaja)( |%|$)|折扣/)) return "discountPercent";
    if (has(s, /(^| )(importe|total|subtotal|amount|valor)( |$)|金额|总价|小计|合计|总额/)) return "lineTotal";
    if (has(s, /(neto|final|net)( |$)|(^| )pre ?f( |$)|(^| )pref( |$)|折后|净价|实价/) && has(s, /prec|pre|precio|price|p |coste|costo|neto|net|final|价/)) return "finalUnitPrice";
    if (has(s, /prec|precio|(^| )pvp|(^| )p ?u( |$)|unit|price|tarifa|coste|costo|单价|价格|进价/)) return "unitPrice";
    if (has(s, /(^| )(cant|cantid|cantidad|uds|ud|u|unid|unidades|qty|quantity|pcs|piezas|bultos|cajas)( |$)|数量|件数|个数/)) return "quantity";
    if (has(s, /(^| )(codigo|cod|code)( |$)|代码/)) return "code";
    return null;
  };
  const gtin = (v) => { const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : "") : String(v ?? "").replace(/\s/g, "");
    if (!/^(\d{8}|\d{12,14})$/.test(s)) return false; const d = s.split("").map(Number), c = d.pop(); let t = 0;
    d.reverse().forEach((x, i) => (t += x * (i % 2 === 0 ? 3 : 1))); return (10 - (t % 10)) % 10 === c; };
  const num = (v) => { if (typeof v === "number") return Number.isFinite(v) ? v : undefined; const n = parseNum(v); return n; };
  const width = Math.max(0, ...rows.slice(0, 300).map((r) => (r ? r.length : 0)));
  // 1) fila de cabeceras: la de las primeras 20 que más campos distintos reconoce
  let hdr = -1, hmap = {}, best = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i] || [], m = {}; let sc = 0;
    r.forEach((c, j) => { const f = headerField(c); if (f && m[f] === undefined) { m[f] = j; sc += f === "barcode" || f === "unitPrice" || f === "lineTotal" ? 2 : 1; } });
    if (Object.keys(m).length >= 2 && sc > best) { best = sc; hdr = i; hmap = m; }
  }
  // 2) contenido de cada columna (filas de datos)
  const data = rows.slice(hdr + 1, hdr + 301).filter((r) => r && r.filter((c) => c !== null && c !== undefined && String(c).trim() !== "").length >= 2);
  const st = Array.from({ length: width }, (_, j) => {
    const vals = data.map((r) => r[j]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    const nums = vals.map(num).filter((x) => x !== undefined);
    return { n: vals.length, gtin: vals.length ? vals.filter(gtin).length / vals.length : 0, num: vals.length ? nums.length / vals.length : 0,
      int: nums.length ? nums.filter((x) => Number.isInteger(x)).length / nums.length : 0,
      text: vals.length ? vals.filter((v) => typeof v === "string" && num(v) === undefined).length / vals.length : 0,
      len: vals.length ? vals.reduce((a, v) => a + String(v).length, 0) / vals.length : 0 };
  });
  const map = {}; const used = new Set(); const take = (f, j) => { if (j === undefined || j < 0 || used.has(j)) return false; map[f] = j; used.add(j); return true; };
  // 3) código de barras: el que tenga más códigos válidos (si la cabecera lo indica y el contenido no lo contradice, la cabecera)
  const bcCands = st.map((s, j) => [j, s.gtin]).filter(([, g]) => g >= 0.5).sort((a, b) => b[1] - a[1]);
  const hb = hmap.barcode ?? hmap.code;
  if (hb !== undefined && (st[hb]?.gtin >= 0.5 || (!bcCands.length && data.length === 0))) take("barcode", hb);
  else if (bcCands.length) take("barcode", bcCands[0][0]);
  // 4) cantidad / precio / descuento / importe: la combinación que cumple cantidad × precio × (1 − dto) = importe
  // como mucho 12 columnas numéricas (las que la cabecera nombra primero) y 80 filas, para que sea instantáneo
  const hinted = new Set(["quantity", "unitPrice", "finalUnitPrice", "discountPercent", "lineTotal"].map((f) => hmap[f]).filter((j) => j !== undefined));
  const numCols = st.map((s, j) => j).filter((j) => !used.has(j) && st[j].num >= 0.6 && st[j].gtin < 0.5)
    .sort((a, b) => hinted.has(b) - hinted.has(a) || st[b].num - st[a].num || a - b).slice(0, 12).sort((a, b) => a - b);
  const sample = data.slice(0, 80);
  const val = (r, j) => (j === undefined ? undefined : num(r[j]));
  const support = (q, p, t, d) => { let ok = 0, n = 0; for (const r of sample) { const Q = val(r, q), P = val(r, p), T = val(r, t), D = d === undefined ? 0 : val(r, d) ?? 0;
    if (Q === undefined || P === undefined || T === undefined || !(Q > 0 && P > 0 && T > 0)) continue; n++; if (D < 0 || D >= 100) continue;
    if (Math.abs(Q * P * (1 - D / 100) - T) <= Math.max(0.02, 0.01 * T)) ok++; } return n >= 2 ? ok / n : 0; };
  let tri = null;
  for (const q of numCols) for (const p of numCols) for (const t of numCols) {
    if (q === p || p === t || q === t) continue;
    for (const d of [undefined, ...numCols.filter((x) => x !== q && x !== p && x !== t)]) {
      const s = support(q, p, t, d); if (s < 0.6) continue;
      const agree = (hmap.quantity === q) + (hmap.lineTotal === t) + (hmap.unitPrice === p || hmap.finalUnitPrice === p) + (d !== undefined && hmap.discountPercent === d);
      const score = s * 10 + agree + (d === undefined ? 0.5 : 0) + st[q].int;   // sin descuento si no hace falta; cantidades enteras
      if (!tri || score > tri.score) tri = { q, p, t, d, s, score };
    }
  }
  if (tri) {
    take("quantity", tri.q); take("lineTotal", tri.t);
    const pIsFinal = hmap.finalUnitPrice === tri.p;
    // ¿el precio que cuadra es en realidad el neto? (otra columna U y un descuento D con U × (1 − D) = ese precio)
    let gross = null;
    if (tri.d === undefined) for (const u of numCols) { if (used.has(u) || u === tri.p) continue;
      for (const d of numCols) { if (used.has(d) || d === u || d === tri.p) continue; let ok = 0, n = 0, diff = 0;
        for (const r of sample) { const U = val(r, u), D = val(r, d) ?? 0, F = val(r, tri.p); if (!(U > 0 && F > 0) || D < 0 || D >= 100) continue; n++;
          if (Math.abs(U * (1 - D / 100) - F) <= Math.max(0.011, 0.01 * F)) { ok++; if (D > 0) diff++; } }
        if (n >= 2 && ok / n >= 0.8 && diff >= 1 && (!gross || ok / n > gross.s)) gross = { u, d, s: ok / n }; } }
    if (tri.d !== undefined) { take("unitPrice", tri.p); take("discountPercent", tri.d); }
    else if (gross) { take("finalUnitPrice", tri.p); take("unitPrice", gross.u); take("discountPercent", gross.d); }
    else if (pIsFinal) take("finalUnitPrice", tri.p); else take("unitPrice", tri.p);
    // precio final aparte (precio × (1 − dto) = precio final, o cantidad × final = importe)
    if (map.finalUnitPrice === undefined) for (const f of numCols) { if (used.has(f)) continue;
      let ok = 0, n = 0; for (const r of data) { const Q = val(r, map.quantity), P = val(r, map.unitPrice), F = val(r, f), T = val(r, map.lineTotal), D = val(r, map.discountPercent) ?? 0;
        if (F === undefined || !(F > 0)) continue; n++; if ((P !== undefined && Math.abs(P * (1 - D / 100) - F) <= Math.max(0.011, 0.01 * F)) && (Q === undefined || T === undefined || Math.abs(Q * F - T) <= Math.max(0.02, 0.01 * T))) ok++; }
      if (n >= 2 && ok / n >= 0.6 && (hmap.finalUnitPrice === f || tri.d !== undefined)) { take("finalUnitPrice", f); break; } }
  } else {
    for (const f of ["quantity", "unitPrice", "finalUnitPrice", "discountPercent", "lineTotal"]) if (hmap[f] !== undefined && (data.length === 0 || st[hmap[f]].num >= 0.5)) take(f, hmap[f]);
  }
  // 5) nombre y referencia
  if (hmap.productName !== undefined && (data.length === 0 || st[hmap.productName].text >= 0.5)) take("productName", hmap.productName);
  if (map.productName === undefined) { const c = st.map((s, j) => [j, s]).filter(([j, s]) => !used.has(j) && s.text >= 0.6).sort((a, b) => b[1].len - a[1].len)[0]; if (c) take("productName", c[0]); }
  const hr = hmap.reference ?? (hmap.code !== undefined && map.barcode !== hmap.code ? hmap.code : undefined); if (hr !== undefined) take("reference", hr);
  // 6) sin cabecera: los datos empiezan en la primera fila con código de barras
  if (hdr < 0 && map.barcode !== undefined) { const first = rows.findIndex((r) => r && gtin(r[map.barcode])); hdr = first > 0 ? first - 1 : -1; }
  const headers = hdr >= 0 ? (rows[hdr] ?? []).map((c) => String(c ?? "").trim()) : [];
  return { headerRowIndex: hdr, mapping: map, headers };
}
function _(e){return e.barcode!==void 0&&(e.finalUnitPrice!==void 0||e.unitPrice!==void 0)}const k={barcode:["cod.barra","cod barra","codigo barra","codigo de barras","codigo de barra","codigo barras","ean","ean13","ean 13","gtin","barcode","bar code","codigo","条码","条形码","商品条码"],name:["articulo","descripcion","producto","nombre","denominacion","name","product","description","商品名称","名称","品名","商品"],stock:["stock","existencias","inventario","cantidad","cant.","cant","unidades","uds","qty","quantity","库存","库存数量","数量"],salePrice:["pvp","p.v.p","p.v.p.","precio venta","precio de venta","precio","venta","sale price","price","retail price","售价","单价","零售价","销售价"],reference:["referencia","ref","ref.","sku","cod.art","cod art","codigo interno","articulo id","货号","编号","编码"]};function q(e){const r=Math.min(e.length,10);let t={idx:-1,mapping:{},score:0};for(let o=0;o<r;o++){const n=e[o];if(!n)continue;const a={};let c=0;n.forEach((l,f)=>{const s=y(l);if(s){for(const[i,d]of Object.entries(k))if(a[i]===void 0&&d.includes(s)){a[i]=f,c+=i==="barcode"?2:1;break}}}),c>t.score&&(t={idx:o,mapping:a,score:c})}return{headerRowIndex:t.idx,mapping:t.mapping}}function C(e){return e.barcode!==void 0}function N(e,r,t){const o=[],n=new Set;let a=0;const c=new Date().toISOString();for(let l=r+1;l<e.length;l++){const f=e[l];if(!f)continue;const s=p=>t[p]!==void 0?f[t[p]]:null,i=g(s("barcode")),d=String(s("name")??"").trim();if(!i||i.length<5){d&&a++;continue}if(n.has(i)){a++;continue}n.add(i),o.push({id:v(),barcode:String(s("barcode")??"").trim(),normalizedBarcode:i,name:d,normalizedName:b(d),reference:String(s("reference")??"").trim()||void 0,stock:m(s("stock")),salePrice:m(s("salePrice")),importedAt:c})}return{items:o,skipped:a}}async function U(e){await u.transaction("rw",u.inventory,async()=>{await u.inventory.clear(),await u.inventory.bulkAdd(e)})}async function j(e){const r=g(e);if(r)return u.inventory.where("normalizedBarcode").equals(r).first()}async function R(){const e=await u.inventory.count();if(e===0)return{count:0};const r=await u.inventory.toCollection().first();return{count:e,importedAt:r==null?void 0:r.importedAt}}async function L(){await u.inventory.clear()}const O=[{key:"lt1",label:"Hasta 1 €",min:0,max:1},{key:"1-2",label:"1 – 2 €",min:1,max:2},{key:"2-5",label:"2 – 5 €",min:2,max:5},{key:"5-10",label:"5 – 10 €",min:5,max:10},{key:"10-20",label:"10 – 20 €",min:10,max:20},{key:"gt20",label:"Más de 20 €",min:20,max:1/0}];export{O as P,q as a,C as b,L as c,M as d,N as e,U as f,j as g,R as i,_ as m,B as r};
