# Auditoría técnica — 轻松管理 (price-scanner-app)

Revisión externa del build publicado (commit `03643ca`), octubre 2026.

## Alcance y limitaciones

- Este repositorio contiene **solo el build compilado** (Vite, minificado, sin source maps). El código fuente
  está en el ordenador del propietario, fuera de GitHub, y no he tenido acceso a él.
- A petición del propietario, los arreglos marcados **✅ APLICADO** se han hecho **directamente sobre el build
  publicado**, con parches quirúrgicos probados (ver "Cambios aplicados" al final).
- ⚠️ **Hay que portarlos al código fuente.** La próxima vez que se compile la app desde el código fuente y se
  publique, estos parches desaparecen. Los fragmentos de cada punto sirven de guía (los nombres de función
  son orientativos: en el minificado no se ven los originales). `sw.js` se copia tal cual a `public/sw.js`.
- Las afirmaciones marcadas **[verificado]** se han comprobado ejecutando el código real del build; el resto
  sale de leer el código.
- No he podido ver la Edge Function de OCR (no está desplegada en los proyectos de Supabase accesibles), así
  que no evalúo qué modelo usa ni su prompt.

## Corrección importante: no existe OCR local (✅ textos corregidos)

La ayuda de Ajustes dice *"si falla o está vacía, se usa el OCR local"*. **No es cierto.** Sin URL de IA y
clave, la importación por foto muestra un error y no lee nada. No hay Tesseract en el build: el chunk
`tesseract-*.js` son 236 bytes de un helper de compatibilidad CommonJS que Rollup nombró así por herencia.
**[verificado]**

✅ Corregidos los dos textos de Ajustes para que digan la verdad. Sigue pendiente decidir si se implementa un OCR local de verdad como respaldo.
Mientras tanto, **sin la función `ocr-albaran` desplegada, la importación de albaranes por foto no funciona.**

---

## P0 — Riesgo de pérdida de datos o datos erróneos

### 1. ✅ APLICADO — La caché crece sin límite y el almacenamiento no es persistente → riesgo de borrar los albaranes
- El service worker usaba siempre la misma caché (`price-scanner-v3`) y nunca borraba los assets de builds
  anteriores: unos 3 MB por despliegue, acumulándose para siempre.
- La app nunca llama a `navigator.storage.persist()`. En modo *best-effort*, cuando el navegador se queda sin
  espacio **borra el origen entero, IndexedDB incluido**: todos los albaranes guardados en el móvil.
- **Aplicado en `sw.js`:** en cada despliegue nuevo se borran los assets que el build actual ya no
  referencia (recorre el grafo de dependencias desde `index.html`). Verificado sobre el build real: los 35
  assets actuales son alcanzables y se conservan. **[verificado]**
- **Aplicado en `index.html`** (y pendiente de portar al código fuente): pedir almacenamiento persistente al arrancar:
  ```ts
  // main.tsx, al arrancar
  if (navigator.storage?.persist) {
    navigator.storage.persisted().then((ok) => ok || navigator.storage.persist());
  }
  ```
  En Chrome Android se concede sin preguntar si la PWA está instalada. Complementar con una exportación
  periódica de la base de datos (botón "Copia de seguridad"): IndexedDB en un móvil no es un sitio seguro
  para ser la única copia.

### 2. ✅ APLICADO — La deduplicación del OCR borra líneas distintas en silencio **[verificado]**
`OcrImportPage` deduplica las líneas entre páginas con la clave `código de barras | cantidad | total`. Dos
artículos sin código de barras con la misma cantidad y total (muy habitual en bazar: docenas de artículos a
1,20 €) se fusionan en uno. Con 3 líneas de prueba entran 3 y salen 2: "VASO CRISTAL" desaparece.
```ts
const lineKey = (l) =>
  [normalize(l.barcode), normalize(l.reference), normalizeName(l.productName), l.quantity, l.lineTotal].join("|");
```
Mejor aún: deduplicar solo cuando el usuario añade **la misma foto dos veces** (hash del fichero), no por
contenido.

### 3. ✅ APLICADO — Los abonos con el menos al final pierden el signo **[verificado]**
`parseMoney("5,00-")` devuelve **+5**. En albaranes españoles el menos final es habitual en abonos y
descuentos, así que el total del albarán sale inflado. Parche (probado sobre el código real, 18/18 casos,
regresiones incluidas):
```ts
const negative = /^-|-$|^\(.*\)$/.test(s);   // antes: /^-|^\(.*\)$/
```

### 4. ✅ APLICADO — Una página de error podía quedar guardada como la app offline — **corregido en `sw.js`**
Cada navegación guardaba la respuesta como shell offline **sin comprobar `res.ok`**. Un 404 o 5xx puntual de
GitHub Pages quedaba como "la app" sin conexión. Ahora solo se guardan respuestas 200 de tipo HTML. **[verificado]**

---

## P1 — Coste y fiabilidad de la IA

### 5. ✅ APLICADO — Los fallos de la IA en PDF se tragan en silencio
En `PdfImportPage`, si la llamada a la IA falla (clave mala, **créditos agotados**, timeout), un
`catch { return false }` cae al parser genérico de baja calidad sin decir por qué. El usuario ve resultados
malos y no sabe que la IA no ha funcionado. Mostrar el error:
```ts
} catch (e) {
  setWarning(`La lectura con IA ha fallado (${e.message}). Mostramos la lectura básica: revísala con cuidado.`);
  return false;
}
```

### 6. ✅ APLICADO — Reintentos ciegos: hasta 3 minutos de espera y posible triple coste
La foto se reintenta 3 veces (esperas de 0/2/5 s), cada intento con 60 s de timeout, **ante cualquier error**,
incluidos 400 y 401 (clave incorrecta), que nunca se arreglan reintentando. Si el gateway corta con 504
después de que el modelo ya ha respondido, cada reintento se vuelve a cobrar. Reintentar solo errores de red,
429 y 5xx:
```ts
class HttpError extends Error { constructor(msg: string, readonly status: number) { super(msg); } }
const retryable = (e: unknown) => !(e instanceof HttpError) || e.status === 429 || e.status >= 500;
// en el bucle: if (!retryable(err)) break;
```

### 7. ✅ APLICADO — Todas las páginas a la vez
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

### 8. ✅ APLICADO — Alta de producto con foto: sin timeout
`photoFill` llama a `/alta-foto` sin `AbortController` (el OCR sí tiene 60 s). Con Wi-Fi mala se queda
"Enviando…" indefinidamente. Además lee `res.json()` antes de mirar `res.ok`, así que un 502 en HTML acaba
mostrando "¿conexión?", que es engañoso.

### 9. La misma clave autoriza cambiar precios y usar la IA
El OCR se autentica con `priceAdminKey`, la "clave para cambiar precios", que vive en el móvil de cada
dependiente. Quien la tenga puede cambiar PVP en la caja, no solo leer albaranes. Separar claves (una de
lectura/OCR y otra de precios) o, al menos, que sea una por tienda y se pueda revocar.

### 9b. El "modo completo" solo se protege en el navegador
La contraseña que desbloquea importar y los ajustes avanzados se comprueba en el propio navegador, y el
resultado se guarda en el almacenamiento local. Cualquiera con el móvil en la mano y conocimientos básicos
puede activar ese modo sin la contraseña. No es grave mientras las acciones con efecto real (cambiar precios,
usar la IA) exijan la clave en el servidor, que es lo que de verdad protege. Pero conviene no tratar esa
contraseña como una medida de seguridad, solo como una forma de que los dependientes no toquen lo que no deben.

### 10. Tamaño de imagen enviado a la IA: correcto, no tocar
La app envía JPEG de hasta 2200 px. Los modelos actuales de Claude procesan hasta 2576 px en el lado largo,
y un albarán es texto denso, así que **no conviene reducirlo**. Coste aproximado: ~4.600 tokens de entrada
por página (un token por cada parche de 28×28 px). El coste por página depende del modelo que use la Edge
Function, que no he podido ver.

---

## P2 — Rendimiento

### 11. ✅ APLICADO — Trabajo de imagen que se calcula y se tira **[verificado]**
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

### 15. La búsqueda recorre la tabla entera en cada consulta
Salvo las búsquedas por prefijo de código de barras o de referencia (que usan índice), buscar por nombre o
por un número corto hace `productLines.toArray()`: toda la tabla en memoria, una vez por búsqueda (con
debounce de 200 ms). Con pocos miles de líneas va bien; si la base crece mucho (decenas de miles), conviene
un índice multientrada de palabras del nombre (`*nameWords`) en Dexie. **Prioridad baja.**
*(Corrección: una versión anterior de este informe decía que la tabla se leía dos veces por búsqueda. No es
así: la normalización de referencias deja solo dígitos, así que los dos recorridos se excluyen entre sí.
Comprobado con 900 búsquedas sobre el código real.)*

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

- ✅ **APLICADO — Fechas imposibles:** el extractor de cabecera de PDF aceptaba `45/13/2026` (→ `2026-13-45`), el 31 de febrero o años de 3 cifras (`12/12/202` → `202-12-12`). Ahora valida contra el calendario real (bisiestos incluidos); si la fecha no existe, queda vacía y el usuario la elige.
- **Separador de miles `1.234`** **[verificado]**: hoy se lee como 1,234. Con el parche del punto 3 (regla:
  un único punto, exactamente 3 decimales y parte entera distinta de 0 → miles) se lee 1.234 y `0.125` sigue
  siendo 0,125. Es una decisión de criterio: un Excel en formato inglés con precio `1.250` pasaría a leerse
  como 1.250 €. Aplicarlo solo si los documentos son siempre en formato español.
- ✅ **APLICADO — Tras publicar, una pestaña abierta puede fallar al cargar un chunk viejo.** Ahora recarga
  sola una vez (como mucho cada 30 s, sin bucle).
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

## Cambios aplicados

Sobre el build publicado (commit `03643ca`), en la rama `claude/bohao-mysql-credentials-b4ukuv`.
**Nada de esto llega a la tienda hasta que se fusione en `main`.**

| Fichero | Cambio |
|---|---|
| `sw.js` | Poda de assets obsoletos por despliegue; no guarda respuestas de error como app offline; timeout de 4 s en la navegación con respaldo en caché; precache sin caché HTTP; al descargar un fichero que no tiene, lo revalida con el servidor (GitHub Pages envía `max-age=600` y, sin esto, un móvil que abriera la app en los 10 min previos a publicar se quedaría con el fichero viejo para siempre); quitada la regla muerta de CDN; caché `v4` (limpia de una vez lo acumulado en `v3` y obliga a descargar los ficheros parcheados). |
| `index.html` | Pide almacenamiento persistente; recarga una vez si falta un chunk tras publicar. |
| `parse-*.js` | Abonos con menos final (`5,00-`) en negativo. |
| `OcrImportPage-*.js` | Deduplicación con referencia y nombre; no reintenta errores 4xx; máximo 2 páginas en paralelo. |
| `OcrLoader-*.js` | Los errores HTTP llevan su código de estado (para decidir si reintentar). |
| `PdfImportPage-*.js` | Avisa cuando falla la IA; valida la fecha de cabecera contra el calendario. |
| `photoFill-*.js` | Alta con foto: timeout de 60 s y error real si el servidor no devuelve JSON. |
| `preprocess-*.js` | Quitado el procesado en escala de grises + PNG que nadie usaba; libera el bitmap. |
| `SettingsPage-*.js` | Textos de ayuda corregidos (no hay OCR local). |

No aplicado sobre el build (requiere el código fuente o una decisión): #9 claves separadas, #12–#14 carga
diferida de xlsx/zxing y escáner en iPhone, #15 búsqueda, #16 fuentes CJK en PDF, #17 varios PDF, separador
de miles `1.234`, zoom bloqueado (quitarlo puede hacer que el iPhone amplíe al tocar un campo).

### Pruebas

**En navegador real (Chromium), misma prueba sobre la versión publicada y la parcheada,** con un servidor de
IA simulado:

| Prueba | Publicada (hoy) | Parcheada |
|---|---|---|
| OCR de 3 páginas, 3 artículos distintos (2 con misma cantidad y total) | **2 productos** (pierde uno) | **3 productos** |
| Páginas enviadas a la IA a la vez | 3 | 2 |
| Clave incorrecta (401): llamadas / tiempo hasta ver el error | 3 / 8,7 s | **1 / 0,8 s** |
| Error temporal (500, 500, OK) | 3 llamadas, leído | 3 llamadas, leído (sin cambios) |
| PDF con la IA sin créditos | no avisa | **avisa** |
| 12 pantallas: errores JavaScript | 0 | 0 |

**Service worker en Chromium real:** un móvil con la versión publicada (`v3`) se actualiza solo a `v4` y la
caché vieja desaparece; la app abre sin conexión; si GitHub Pages devuelve 503 se sirve la app guardada y el
503 no la sustituye; si tras publicar falta un fichero, recarga una vez y no entra en bucle. 8/8. Además, con un servidor que envía
`max-age=600` como GitHub Pages: un móvil que abrió la versión publicada justo antes de publicar acaba con el
fichero **parcheado**; con el `sw.js` sin la revalidación (control) se quedaba con el **viejo**.

**Pruebas aisladas con el código real:** parser de importes 18/18 (incluidas regresiones); fecha de cabecera
9/9 (incluidos bisiestos); service worker con `Cache`/`fetch` simulados 14/14; poda contra los 35 assets del
build real.

**No probado:** en un móvil físico (cámara, PWA instalada, permiso de almacenamiento persistente, que en
Chromium sin interfaz no se concede) ni el timeout del alta con foto (60 s). Antes de fusionar en `main`,
abrir la rama en un móvil y hacer una importación real.
