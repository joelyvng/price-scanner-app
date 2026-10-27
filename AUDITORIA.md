# Auditoría técnica — 轻松管理 (price-scanner-app)

Revisión externa del build publicado (commit `03643ca`), octubre 2026.

## Alcance y limitaciones

- Este repositorio contiene **solo el build compilado** (Vite, minificado, sin source maps). El código fuente
  vive en otro sitio y no he tenido acceso a él. Por eso:
  - **El único cambio aplicado es `sw.js`**, que no pasa por el compilador (Vite lo copia tal cual desde
    `public/`). **Hay que copiarlo también a `public/sw.js` en el repo de fuentes**, o el próximo build lo
    sobrescribirá con la versión antigua.
  - Todo lo demás son **recomendaciones con parche propuesto** para aplicar en el código fuente. Los nombres
    de funciones de los fragmentos son orientativos: en el minificado no se ven los originales.
- Las afirmaciones marcadas **[verificado]** se han comprobado ejecutando el código real del build; el resto
  sale de leer el código.
- No he podido ver la Edge Function de OCR (no está desplegada en los proyectos de Supabase accesibles), así
  que no evalúo qué modelo usa ni su prompt.

## Corrección importante: no existe OCR local

La ayuda de Ajustes dice *"si falla o está vacía, se usa el OCR local"*. **No es cierto.** Sin URL de IA y
clave, la importación por foto muestra un error y no lee nada. No hay Tesseract en el build: el chunk
`tesseract-*.js` son 236 bytes de un helper de compatibilidad CommonJS que Rollup nombró así por herencia.
**[verificado]**

Decisión pendiente: o se corrige el texto de ayuda, o se implementa un OCR local de verdad como respaldo.
Mientras tanto, **sin la función `ocr-albaran` desplegada, la importación de albaranes por foto no funciona.**

---

## P0 — Riesgo de pérdida de datos o datos erróneos

### 1. La caché crece sin límite y el almacenamiento no es persistente → riesgo de borrar los albaranes
- El service worker usaba siempre la misma caché (`price-scanner-v3`) y nunca borraba los assets de builds
  anteriores: unos 3 MB por despliegue, acumulándose para siempre.
- La app nunca llama a `navigator.storage.persist()`. En modo *best-effort*, cuando el navegador se queda sin
  espacio **borra el origen entero, IndexedDB incluido**: todos los albaranes guardados en el móvil.
- **Aplicado en `sw.js`:** en cada despliegue nuevo se borran los assets que el build actual ya no
  referencia (recorre el grafo de dependencias desde `index.html`). Verificado sobre el build real: los 35
  assets actuales son alcanzables y se conservan. **[verificado]**
- **Pendiente en fuentes:** pedir almacenamiento persistente al arrancar:
  ```ts
  // main.tsx, al arrancar
  if (navigator.storage?.persist) {
    navigator.storage.persisted().then((ok) => ok || navigator.storage.persist());
  }
  ```
  En Chrome Android se concede sin preguntar si la PWA está instalada. Complementar con una exportación
  periódica de la base de datos (botón "Copia de seguridad"): IndexedDB en un móvil no es un sitio seguro
  para ser la única copia.

### 2. La deduplicación del OCR borra líneas distintas en silencio **[verificado]**
`OcrImportPage` deduplica las líneas entre páginas con la clave `código de barras | cantidad | total`. Dos
artículos sin código de barras con la misma cantidad y total (muy habitual en bazar: docenas de artículos a
1,20 €) se fusionan en uno. Con 3 líneas de prueba entran 3 y salen 2: "VASO CRISTAL" desaparece.
```ts
const lineKey = (l) =>
  [normalize(l.barcode), normalize(l.reference), normalizeName(l.productName), l.quantity, l.lineTotal].join("|");
```
Mejor aún: deduplicar solo cuando el usuario añade **la misma foto dos veces** (hash del fichero), no por
contenido.

### 3. Los abonos con el menos al final pierden el signo **[verificado]**
`parseMoney("5,00-")` devuelve **+5**. En albaranes españoles el menos final es habitual en abonos y
descuentos, así que el total del albarán sale inflado. Parche (probado sobre el código real, 18/18 casos,
regresiones incluidas):
```ts
const negative = /^-|-$|^\(.*\)$/.test(s);   // antes: /^-|^\(.*\)$/
```

### 4. Una página de error podía quedar guardada como la app offline — **corregido en `sw.js`**
Cada navegación guardaba la respuesta como shell offline **sin comprobar `res.ok`**. Un 404 o 5xx puntual de
GitHub Pages quedaba como "la app" sin conexión. Ahora solo se guardan respuestas 200 de tipo HTML. **[verificado]**

---

## P1 — Coste y fiabilidad de la IA

### 5. Los fallos de la IA en PDF se tragan en silencio
En `PdfImportPage`, si la llamada a la IA falla (clave mala, **créditos agotados**, timeout), un
`catch { return false }` cae al parser genérico de baja calidad sin decir por qué. El usuario ve resultados
malos y no sabe que la IA no ha funcionado. Mostrar el error:
```ts
} catch (e) {
  setWarning(`La lectura con IA ha fallado (${e.message}). Mostramos la lectura básica: revísala con cuidado.`);
  return false;
}
```

### 6. Reintentos ciegos: hasta 3 minutos de espera y posible triple coste
La foto se reintenta 3 veces (esperas de 0/2/5 s), cada intento con 60 s de timeout, **ante cualquier error**,
incluidos 400 y 401 (clave incorrecta), que nunca se arreglan reintentando. Si el gateway corta con 504
después de que el modelo ya ha respondido, cada reintento se vuelve a cobrar. Reintentar solo errores de red,
429 y 5xx:
```ts
class HttpError extends Error { constructor(msg: string, readonly status: number) { super(msg); } }
const retryable = (e: unknown) => !(e instanceof HttpError) || e.status === 429 || e.status >= 500;
// en el bucle: if (!retryable(err)) break;
```

### 7. Todas las páginas a la vez
`Promise.all` procesa todas las fotos en paralelo: decodifica N fotos de 12 MP a la vez (~48 MB cada una en
memoria) y lanza N llamadas simultáneas a la IA (más probabilidad de 429). En móviles modestos puede cerrar
la pestaña. Limitar a 2 en paralelo:
```ts
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>) {
  const out: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
```

### 8. Alta de producto con foto: sin timeout
`photoFill` llama a `/alta-foto` sin `AbortController` (el OCR sí tiene 60 s). Con Wi-Fi mala se queda
"Enviando…" indefinidamente. Además lee `res.json()` antes de mirar `res.ok`, así que un 502 en HTML acaba
mostrando "¿conexión?", que es engañoso.

### 9. La misma clave autoriza cambiar precios y usar la IA
El OCR se autentica con `priceAdminKey`, la "clave para cambiar precios", que vive en el móvil de cada
dependiente. Quien la tenga puede cambiar PVP en la caja, no solo leer albaranes. Separar claves (una de
lectura/OCR y otra de precios) o, al menos, que sea una por tienda y se pueda revocar.

### 10. Tamaño de imagen enviado a la IA: correcto, no tocar
La app envía JPEG de hasta 2200 px. Los modelos actuales de Claude procesan hasta 2576 px en el lado largo,
y un albarán es texto denso, así que **no conviene reducirlo**. Coste aproximado: ~4.600 tokens de entrada
por página (un token por cada parche de 28×28 px). El coste por página depende del modelo que use la Edge
Function, que no he podido ver.

---

## P2 — Rendimiento

### 11. Trabajo de imagen que se calcula y se tira **[verificado]**
`preprocess` convierte cada foto a escala de grises, estira el contraste y la codifica en **PNG**
(`toDataURL`, síncrono, en el hilo principal). Ese resultado **no lo usa nadie**: tanto el OCR como el alta
con foto envían `originalUrl`, el JPEG. Es CPU y memoria malgastadas en cada foto, con la interfaz
bloqueada. Eliminar ese bloque y cerrar el bitmap tras dibujarlo (`bitmap.close()`).

### 12. El escáner descarga xlsx (333 KB) sin necesitarlo
Cadena: `ScanPage → ScanResultSheet → productCreations → inventoryService → xlsx`. `inventoryService`
importa `xlsx` de forma estática solo para leer inventarios en Excel. Cambiarlo a import dinámico dentro de
esa función:
```ts
async function readInventoryFile(file: File) {
  const XLSX = await import("xlsx");
  ...
}
```

### 13. El escáner descarga zxing (411 KB) aunque el móvil tenga detector nativo
En Android con Chrome se usa `BarcodeDetector` nativo, pero zxing se descarga igual porque se importa
estáticamente. Cargarlo solo cuando no hay detector nativo:
```ts
const detector = await createNativeDetector();
const reader = detector ? null : await import("@zxing/library").then(createZxingReader);
```
Entre #12 y #13, abrir `/escanear` en Android pasa de unos 745 KB extra a cero.

### 14. En iPhone, zxing bloquea el hilo principal
Safari no tiene `BarcodeDetector`, así que en iPhone corre zxing con `TRY_HARDER` y 8 formatos sobre un
canvas de 1280 px cada 90 ms, en el hilo principal: batería y calor en un uso de todo el día. Opciones, de
menor a mayor esfuerzo: quitar `TRY_HARDER` en la primera pasada; reducir formatos a EAN-13/EAN-8/UPC (lo que
llevan los productos de bazar); mover la decodificación a un Web Worker con `OffscreenCanvas`.

### 15. La búsqueda carga la tabla entera, dos veces
En `repo.search`, buscar por referencia alfanumérica y por nombre hace `productLines.toArray()` en cada
caso: toda la tabla en memoria, dos veces por búsqueda. Con 50 albaranes de 200 líneas son 10.000 registros
cada vez. Hay debounce de 200 ms, pero no basta a esa escala. Una sola pasada con corte temprano:
```ts
await db.productLines.filter((l) => matchesRef(l) || matchesName(l)).limit(limit).toArray();
```

### 16. PDF con fuentes chinas: probable lectura defectuosa (verificar)
pdf.js se usa sin `cMapUrl` ni `standardFontDataUrl`. Los PDF con fuentes CJK que dependen de CMaps
predefinidos (frecuentes en mayoristas chinos) pueden extraer texto vacío o corrupto. Eso empuja el documento
a la IA, que cuesta, o deja un resultado malo. Copiar `pdfjs-dist/cmaps/` y `standard_fonts/` a `public/` y
configurar `cMapUrl`, `cMapPacked: true` y `standardFontDataUrl`. **Probar antes con un albarán PDF real de
un proveedor chino.**

### 17. Compartir varios PDF: solo se procesa el primero
El share target acepta varios ficheros, pero `PdfImportPage` solo lee `files[0]`; el resto se ignora sin
avisar.

---

## P3 — Menores

- **Fechas sin validar rango:** el extractor de cabecera de PDF acepta `45/13/2026` y produce `2026-13-45`.
- **Separador de miles `1.234`** **[verificado]**: hoy se lee como 1,234. Con el parche del punto 3 (regla:
  un único punto, exactamente 3 decimales y parte entera distinta de 0 → miles) se lee 1.234 y `0.125` sigue
  siendo 0,125. Es una decisión de criterio: un Excel en formato inglés con precio `1.250` pasaría a leerse
  como 1.250 €. Aplicarlo solo si los documentos son siempre en formato español.
- **Tras un despliegue, una pestaña abierta puede fallar al cargar un chunk viejo.** Añadir
  `window.addEventListener("vite:preloadError", () => location.reload())`.
- **Accesibilidad:** `user-scalable=no, maximum-scale=1` impide hacer zoom. Quitarlo de `index.html`.
- **Comentarios desfasados** en `sw.js` (Tesseract por CDN, "Edge Functions en el mismo origen"):
  corregidos en este cambio.

---

## Lo que está bien hecho

- **PDF primero por texto:** lee la capa de texto con pdf.js, detecta el perfil de proveedor con parsers
  locales y solo llama a la IA si el parser no está seguro. Y le envía texto, no imagen: mucho más barato.
- **Escáner:** prefiere el detector nativo, recorta una franja central, reduce resolución, filtra lecturas
  repetidas y evita la cámara ultra gran angular.
- **Datos:** transacciones Dexie, `bulkAdd`, normalización al guardar y validación de coherencia entre
  precio, descuento y total, con nivel de confianza por línea.
- **Heurística de precio por pack** (×10/×100/×1000) para corregir precios unitarios mal escalados.

## Cambios aplicados en este commit

| Fichero | Cambio |
|---|---|
| `sw.js` | Poda de assets obsoletos por despliegue; no cachear respuestas de error como shell; timeout de 4 s en navegación con respaldo en caché; precache que salta la caché HTTP; eliminada la regla muerta de CDN; caché renombrada a `v4` (limpia de una vez lo acumulado en `v3`). |

Pruebas: 14 casos con `Cache`/`fetch` simulados ejecutando el `sw.js` real (instalación, navegación,
404, red lenta, sin red, poda en dos niveles, orígenes externos) y comprobación de la poda contra el build
real. Todo en verde. **No probado en un navegador real:** validarlo en un móvil antes de publicarlo
(DevTools → Application → Service Workers / Cache Storage).
