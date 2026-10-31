# Auditoría técnica — 轻松管理 (price-scanner-app)

Revisión externa del build publicado (commit `03643ca`, publicado el 14/09/2026). Octubre de 2026.

## Resumen para el propietario

- **Hecho:** más de 20 arreglos y mejoras aplicados directamente sobre el build publicado, todos probados en un
  navegador real **contra la versión que usa hoy la tienda**. Están en la rama
  `claude/bohao-mysql-credentials-b4ukuv`; **la tienda no ve nada hasta que se fusione en `main`.**
- **Lo más importante que cambia para el usuario:** el OCR ya no pierde productos; los PDF con fuentes chinas y
  los PDF escaneados con JPEG 2000 ahora se leen (antes, nada / página en blanco); la app avisa cuando la IA
  falla o no tiene créditos; el escáner va fluido en iPhone; cada pantalla descarga hasta 745 KB menos; menos
  riesgo de perder los albaranes guardados en el móvil.
- **Pendiente de decidir por ti** (sección Seguridad): la copia de seguridad incluye la clave de precios; la
  consulta de inventario no pide clave; la contraseña de desbloqueo no protege de verdad.
- ⚠️ **Hay que portar estos cambios al código fuente** (tu carpeta local) antes de volver a compilar y publicar
  desde ella, o se perderán. Ver "Cómo portar al código fuente".

## Alcance y método

- Este repositorio contiene **solo el build compilado** (Vite, minificado, sin source maps). El código fuente
  está en el ordenador del propietario y no he tenido acceso a él.
- Cada arreglo es un parche quirúrgico sobre el build. Para cada uno: el texto original debe aparecer
  exactamente una vez (si no, no se aplica nada); comprobación de sintaxis; ESLint `no-undef` contra la línea
  base de la versión publicada (0 referencias nuevas sin declarar); y prueba funcional. Las pruebas en
  navegador ejecutan **lo mismo sobre la versión publicada y sobre la parcheada** para ver el antes/después.
- **[verificado]** = comprobado ejecutando el código real. Lo demás sale de leer el código.
- No he podido ver las Edge Functions (`ocr-albaran`, `inventario`, `precios`, `altas`): no están desplegadas
  en los proyectos de Supabase accesibles. Lo que digo del servidor se deduce de lo que hace el cliente.

---

## 1. Datos e integridad

### 1.1 ✅ La caché crecía sin límite y el almacenamiento no era persistente [verificado]
El service worker no borraba nunca los ficheros de versiones anteriores (~3 MB por publicación) y la app no
pedía almacenamiento persistente. Cuando el móvil se queda sin espacio, el navegador puede **borrar el origen
entero, IndexedDB incluido: todos los albaranes**.
- `sw.js`: en cada publicación borra lo que el build nuevo ya no usa (recorre el grafo de dependencias).
  Comprobado contra el build real: conserva los 35 ficheros actuales.
- `index.html`: pide almacenamiento persistente (en Chrome Android con la PWA instalada se concede solo).
- La app ya tiene **copia de seguridad** (Ajustes → Exportar/Importar backup), bien hecha: valida el formato y
  restaura en una transacción. Recomendación: hacer una copia periódica; un móvil no debe ser la única copia.

### 1.2 ✅ La deduplicación del OCR borraba artículos distintos [verificado]
Las líneas se deduplicaban por `código de barras | cantidad | total`. Dos artículos sin código con la misma
cantidad y total (muy habitual en bazar) se fusionaban. **Navegador: 3 artículos distintos → la versión
publicada guarda 2.** Ahora la clave incluye referencia y nombre: guarda 3, y un duplicado real se sigue quitando.
*Corrección (31/10): la primera versión de este arreglo usaba siempre referencia y nombre, y duplicaba una línea
leída en dos fotos solapadas con el nombre algo distinto ("9CM" / "9 CM"): 3 artículos → 4. Lo notaron en la
tienda. Ahora: con código de barras se deduplica como antes (código + cantidad + total); sin código, con
referencia y nombre. Probado en navegador contra las dos versiones anteriores en 4 escenarios.*

### 1.3 ✅ Los abonos con el menos al final salían en positivo [verificado]
`5,00-` (habitual en abonos y descuentos de albaranes españoles) se leía como +5. Corregido; 12/12 casos,
incluidas regresiones.

### 1.4 ✅ PDF con fuentes chinas: no se leía nada [verificado]
pdf.js se usaba sin `cMapUrl`. Un PDF con texto en una fuente china no incrustada (codificación predefinida
`UniGB-UCS2-H`, típica de programas de facturación chinos) se trataba como **"Este PDF es un escaneo"**: ni el
chino, ni las palabras latinas, ni los números. El usuario acababa "leyéndolo como foto" → IA → coste.
**Ahora extrae el texto completo y exacto** (`送货单 ALBARAN 2026/555`, `陶瓷杯子 TAZA CERAMICA 12 1,20 14,40`…),
descargando solo los 2 ficheros de tabla que necesita.

### 1.5 ✅ PDF escaneados con JPEG 2000: página en blanco [verificado] (JBIG2: muy probable)
pdf.js 6 carga sus decodificadores de imagen en WebAssembly desde `wasmUrl`, que no se pasaba. Un albarán
escaneado con imagen JPEG 2000 se convertía en **una página completamente en blanco** (0,0 % de píxeles
oscuros) que se enviaba a la IA: se paga la llamada y no se lee nada. Ahora la página sale bien (el código de
barras de la prueba se lee). JBIG2 —la compresión típica de los escáneres de oficina en blanco y negro— usa
exactamente el mismo cargador, así que casi seguro le pasaba lo mismo; no lo he podido probar con un fichero
JBIG2 real.
- Añadida la carpeta `pdfjs/` con `cmaps`, `standard_fonts`, `wasm` e `iccs` de **pdfjs-dist 6.2.108** (la
  versión exacta del build), sin modificar y con sus licencias. Solo se descargan cuando un PDF las necesita.

### 1.6 ✅ Una página de error podía quedarse como la app sin conexión [verificado]
El service worker guardaba cualquier respuesta como shell offline, también un 404/503. Ahora solo guarda
respuestas 200 HTML. Navegador: con GitHub Pages devolviendo 503, se sirve la app guardada.

### 1.7 ✅ Riesgo de quedarse con un fichero viejo tras publicar [verificado]
GitHub Pages envía `cache-control: max-age=600`. Un móvil que hubiera abierto la app en los 10 minutos previos
a publicar se quedaba **para siempre** con la versión vieja de un fichero (la caché del SW va por nombre).
Reproducido con un servidor que imita a GitHub Pages: sin el arreglo, el móvil guarda el fichero viejo; con
él, el nuevo. El SW ahora revalida con el servidor al descargar (ETag → 304 si no ha cambiado).

## 2. IA: coste y fiabilidad

### 2.1 ✅ Los fallos de la IA se tragaban en silencio (PDF) [verificado]
Si la IA fallaba (clave mala, **créditos agotados**, timeout) se mostraba una lectura básica peor sin decir por
qué. Ahora: *"La lectura con IA ha fallado (motivo). Mostramos la lectura básica: revísala con cuidado."*

### 2.2 ✅ Reintentos ciegos ante errores que no se arreglan reintentando [verificado]
Se reintentaba 3 veces cualquier error, también 401 (clave incorrecta). *Corrección (31/10): la primera versión dejaba de reintentar todos los 4xx; si la función devuelve un 4xx en
un fallo pasajero (p. ej. respuesta de la IA mal formada), esa página se perdía. Ahora solo se deja de
reintentar con 401/403.* **Navegador: 3 llamadas y 8,7 s hasta
ver el error → 1 llamada y 0,8 s.** Los errores temporales (408, 429, 5xx, red) se siguen reintentando
(comprobado: 500, 500, OK → se lee).

### 2.2b ✅ Columnas desplazadas en la lectura de la IA [verificado]
Con fotos malas, la IA a veces no lee un valor de una columna (p. ej. una cantidad) y "rellena" con el de la
línea siguiente: desde ahí todo queda corrido una posición. No lo causa la app: se comprobó que la foto enviada
a la IA es idéntica byte a byte a la de la versión original. Ahora, al recibir la respuesta, la app comprueba
**cantidad × precio = importe** (y **precio × (1 − descuento) = precio final**) en todas las líneas a la vez; si
una hipótesis "esta columna está corrida desde la línea k" hace cuadrar al menos 2 líneas más **sin estropear
ninguna que ya cuadraba**, la aplica, deduce el valor que faltaba y marca esas líneas con una nota para revisar.
- 20.000 albaranes simulados con una columna corrida: 88 % quedan exactamente bien, 12 % sin tocar (como antes,
  sobre todo si el fallo está en las 2 últimas líneas), **0 % peor**. Lecturas correctas: 100 % intactas.
  Líneas erróneas que pasaban sin ningún aviso: de 6.786 a 1.062.
- Limitación: si lo que se corre es la columna de **nombres** respecto a los números, la aritmética no lo
  detecta. Para eso hay que mejorar la instrucción de la función `ocr-albaran` (leer fila a fila y devolver
  `null` en las celdas ilegibles en vez de rellenar con la siguiente).

### 2.3 ✅ Todas las páginas a la vez [verificado]
Ahora máximo 2 fotos en paralelo (menos memoria en móviles modestos y menos riesgo de límite de peticiones).

### 2.4 ✅ Mensajes de error engañosos [verificado]
Alta con foto, cambio de precio y alta de producto mostraban "sin conexión" ante cualquier respuesta que no
fuera JSON (p. ej. un 502). Ahora muestran el error real. El alta con foto, además, tenía espera infinita:
ahora 60 s.

### 2.5 Tamaño de la foto enviada a la IA: correcto, no tocar
JPEG de hasta 2200 px. Los modelos actuales de Claude procesan hasta 2576 px en el lado largo y un albarán es
texto denso. Coste aproximado: ~4.600 tokens de entrada por página.

## 3. Rendimiento

### 3.1 ✅ El escáner bloqueaba la interfaz en iPhone [verificado]
En móviles sin detector nativo (iPhone/Safari), zxing analizaba cada fotograma en modo `TRY_HARDER`: **504 ms
por fotograma vacío** (lo normal mientras apuntas). Medido con cámara simulada en Chromium:

| Escáner | Publicada (hoy) | Ahora |
|---|---|---|
| Apuntando sin código: interfaz bloqueada | 83 % (picos de 796 ms) | **23 %** (picos de 108 ms) |
| Fotogramas analizados por segundo | 1,7 | **6,8** |
| Código que se enfoca: tiempo hasta leer | 2,9 s | **2,7 s** |
| Código vertical (botella/lata) | 0,8 s | **0,7 s** |

Método: el único caso que solo resolvía `TRY_HARDER` en vídeo realista era el **código vertical** (ni el
desenfoque ni el contraste cambiaban nada: lo que lee uno lo lee el otro). Así que el escaneo continuo usa el
modo rápido y, si un fotograma falla, uno de cada dos se reintenta **girado 90°** en modo rápido (~15 ms en vez
de ~500). "Leer código de una foto" mantiene `TRY_HARDER` (una sola imagen, el coste da igual). En Android con
detector nativo no cambia nada.

### 3.2 ✅ Librerías descargadas sin necesidad [verificado]
- **xlsx (333 KB)** se descargaba en 10 pantallas (escáner, OCR, PDF, búsqueda, producto, catálogo…) y solo
  se usa para leer un Excel. Ahora solo en las dos pantallas de importar Excel.
- **zxing (411 KB)** se descargaba siempre; ahora solo si el móvil no tiene detector nativo.
- Abrir el escáner: **745 KB menos en Android, 333 KB menos en iPhone.** Comprobado que importar el Excel de
  ejemplo da el mismo resultado (9 productos) y que la cámara y la foto leen el código igual.

### 3.3 ✅ Trabajo de imagen que se calculaba y se tiraba [verificado]
Cada foto se convertía a escala de grises con contraste y PNG de 3,6 MP en el hilo principal, y ese resultado
no lo usaba nadie. Eliminado; se libera además el bitmap.

### 3.4 La búsqueda recorre la tabla entera en cada consulta — prioridad baja
Por nombre o número corto hace `productLines.toArray()` una vez por búsqueda (con debounce de 200 ms). Bien
con pocos miles de líneas; si crece mucho, índice multientrada de palabras del nombre en Dexie.
*(Corrección: una versión anterior de este informe decía "dos veces". No es así: comprobado con 900 búsquedas.)*

## 4. Seguridad — decisiones tuyas (no aplicado)

### 4.1 La consulta de inventario no pide clave
La ficha de producto consulta `inventario?barcode=…` **sin clave** (el catálogo y los cambios de precio sí la
envían). Para que la app funcione, ese endpoint responde sin autenticación con **coste, PVP y stock** a
cualquiera que tenga la URL. Recomendación: exigir la clave también ahí (cambio en servidor + 1 línea en la app).

### 4.2 La misma clave sirve para cambiar precios y para la IA
Quien tenga la "clave para cambiar precios" (en el móvil de cada dependiente) puede cambiar PVP en la caja.
Recomendación: claves separadas, una por tienda, revocables.

### 4.3 La copia de seguridad incluye la clave de precios [verificado en el código]
"Exportar backup" guarda los ajustes completos, clave incluida. Si el fichero se envía por WhatsApp o correo,
la clave va dentro. Recomendación: quitarla de la exportación (al restaurar en otro móvil habría que volver a
escribirla). No lo he cambiado porque altera cómo funciona la restauración.

### 4.4 La contraseña de desbloqueo no protege de verdad
El "modo completo" se comprueba en el navegador y se guarda en almacenamiento local: se puede activar sin la
contraseña con conocimientos básicos. Además, su hash (SHA rápido, sin sal) está en el código público, así que
una contraseña corta o común se puede adivinar sin conexión. No es grave mientras lo que tiene efecto real
exija la clave en el servidor, pero: **no reutilices esa contraseña en ningún otro sitio** (TPV, Supabase,
correo…) y no la trates como medida de seguridad.

## 5. Menores

- ✅ Fechas imposibles en la cabecera de PDF (`45/13/2026`, 31 de febrero, año de 3 cifras): ahora se validan
  contra el calendario (bisiestos incluidos); si no existe, queda vacía. [verificado, 9/9]
- ✅ Los textos de Ajustes prometían un "OCR local" que no existe. Corregidos. Sigue pendiente decidir si se
  implementa un OCR local de verdad como respaldo: **hoy, sin la función `ocr-albaran`, no se leen fotos.**
- ✅ Compartir varios PDF: solo se lee el primero; ahora lo avisa.
- ✅ Tras publicar, una pestaña abierta que pide un fichero que ya no existe recarga una vez (sin bucle).
- Separador de miles `1.234`: **no aplicado, a propósito.** La importación de Excel lee las celdas numéricas
  como números, así que solo afectaría a texto; y en un Excel en formato inglés `1.250` es 1,25 €.
- Zoom bloqueado (`user-scalable=no`): no cambiado; quitarlo puede hacer que el iPhone amplíe al tocar un campo.

## 6. Revisado y correcto (sin cambios)

- **Redondeo de precios "bazar"** [verificado con todos los costes de 0,01 € a 50 €]: con los multiplicadores
  que ofrece la app (x1,9 en adelante) nunca da un precio por debajo del coste, y el margen medio sale
  exactamente el objetivo a partir de 0,50 € de coste. Solo con multiplicadores personalizados muy bajos
  (x1,1–x1,3) y artículos de céntimos puede quedar por debajo.
- **Ficha de producto si la caja falla** [verificado]: 500 → datos locales; "no existe" → "no encontrado";
  existe → dato de la caja.
- PDF primero por texto con parsers locales; la IA solo si no hay seguridad, y con texto (barato).
- Escáner: detector nativo, recorte central, filtro de lecturas repetidas, evita la cámara ultra gran angular.
- Datos: transacciones Dexie, normalización, validación de coherencia precio/descuento/total.
- Reemplazar el inventario pide confirmación. Casi todas las llamadas de red llevan timeout.

---

## Cambios aplicados

| Fichero | Cambio |
|---|---|
| `sw.js` | Poda por publicación; no guarda errores como app offline; timeout de 4 s en navegación; revalida ficheros al descargarlos; caché `v4`; quitada regla muerta de CDN. |
| `index.html` | Almacenamiento persistente; recarga una vez si falta un chunk tras publicar. |
| `pdfjs/` (nuevo) | Recursos de pdf.js 6.2.108: `cmaps`, `standard_fonts`, `wasm`, `iccs` (+ licencias). |
| `PdfImportPage-*.js` | `getDocument` con `cMapUrl`, `standardFontDataUrl`, `wasmUrl`, `iccUrl`; aviso de fallo de IA; fechas válidas; aviso de varios PDF; sin precarga de xlsx. |
| `ScanPage-*.js` | Escaneo continuo rápido + pasada girada 90°; zxing bajo demanda; sin precarga de xlsx. |
| `OcrImportPage-*.js` | Deduplicación con referencia y nombre; no reintenta 4xx; máx. 2 páginas en paralelo. |
| `OcrLoader-*.js` | Los errores HTTP llevan su código de estado. |
| `inventoryService-*.js` | xlsx se carga solo al leer un Excel. |
| `index-*.js` | Mapa de precargas: xlsx solo en las pantallas de Excel; zxing fuera del escáner. |
| `parse-*.js` | Abonos con menos final. |
| `photoFill-*.js`, `productCreations-*.js` | Timeout en alta con foto; errores reales del servidor. |
| `preprocess-*.js` | Quitado el procesado que nadie usaba; libera el bitmap. |
| `SettingsPage-*.js` | Textos corregidos (no hay OCR local). |
| 8 pantallas más | Quitada la precarga de xlsx. |

## Pruebas

Ejecutadas sobre el resultado final. **Navegador real (Chromium)**, misma prueba sobre la versión publicada y la
parcheada, con servidor de IA simulado:

| Prueba | Publicada (hoy) | Parcheada |
|---|---|---|
| OCR, 3 artículos distintos (2 con misma cantidad y total) | 2 productos | **3** |
| Clave de IA incorrecta (401) | 3 llamadas, 8,6 s | **1 llamada, 0,8 s** |
| Error temporal (500, 500, OK) | se lee | se lee |
| PDF con la IA sin créditos | no avisa | **avisa** |
| PDF con fuentes chinas | "es un escaneo", 0 texto | **texto completo** |
| PDF escaneado JPEG 2000 → "leer como foto" | página en blanco | **página correcta** |
| Varios PDF compartidos | no avisa | **avisa** |
| ¿Descarga xlsx? (7 pantallas) | en todas | solo en importar Excel |
| Escáner con detector nativo: zxing / xlsx | sí / sí | **no / no** |
| Cámara lee EAN-13 / foto de un código / Excel de ejemplo | sí / sí / 9 | sí / sí / 9 |
| Ficha de producto con la caja caída | datos locales | datos locales |
| 12 pantallas: errores JavaScript | 0 | 0 |

**Service worker en Chromium real:** un móvil con la versión publicada (`v3`) se actualiza solo a `v4` y la
caché vieja desaparece; abre sin conexión; con 503 de GitHub Pages sirve la app guardada; si falta un fichero
recarga una vez y no entra en bucle; con caché HTTP de 10 min guarda el fichero nuevo (control sin el arreglo:
el viejo). 9/9.

**Aisladas con el código real:** parser de importes 12/12; fechas 9/9; service worker simulado 14/14; mensajes
de error 4/4; poda contra los 35 ficheros del build; ESLint sin referencias nuevas sin declarar.

**No probado:** en un móvil físico (cámara real, iPhone, PWA instalada, permiso de almacenamiento persistente);
un PDF JBIG2 real; el timeout de 60 s del alta con foto. Antes de fusionar: abrir la app en un móvil y hacer una
importación real de foto y de PDF.

## Cómo portar al código fuente

Antes de volver a compilar desde la carpeta local, aplicar en el código fuente (las búsquedas se hacen por el
texto de los mensajes, que no cambia al compilar):

1. Copiar `sw.js` a `public/sw.js` y la carpeta `pdfjs/` a `public/pdfjs/`.
2. `index.html`: el bloque de `navigator.storage.persist()` y `vite:preloadError`.
3. Donde se llama a `getDocument`: añadir `cMapUrl`, `cMapPacked: true`, `standardFontDataUrl`, `wasmUrl`,
   `iccUrl` (rutas de `public/pdfjs/`).
4. Parser de importes: `/^-|-$|^\(.*\)$/` para detectar negativos.
5. Importación por foto: clave de deduplicación con referencia y nombre; no reintentar 4xx salvo 408/429;
   máximo 2 páginas en paralelo (y que el error HTTP lleve `status`).
6. Importación PDF: mostrar el error de la IA (acumulando mensajes); validar la fecha con `new Date(...)`;
   avisar si hay más de un PDF.
7. Escáner: lector sin `TRY_HARDER` en el bucle continuo + reintento con el fotograma girado 90° cada dos
   fallos; `import()` de zxing solo si no hay `BarcodeDetector`.
8. `import("xlsx")` dinámico dentro de la función que lee el Excel.
9. Preprocesado de foto: quitar el bloque de escala de grises + PNG; `bitmap.close()`.
10. `res.json().catch(() => null)` en alta con foto, cambio de precio y alta; timeout en alta con foto.
11. Textos de Ajustes sobre el OCR local.

Si en el futuro se vuelve a editar a mano un fichero de `assets/` sin cambiar su nombre, subir `CACHE` en `sw.js`.
