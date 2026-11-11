# Detección automática de columnas al importar un Excel de albarán

Código para portar al repositorio fuente de la app. Sustituye a la detección de columnas actual, que solo
reconocía una columna si la cabecera coincidía **exactamente** con una lista corta de palabras. Por eso el
usuario tenía que asignar columnas a mano con cabeceras normales ("Código EAN", "Precio Unit.", "Uds.",
"Importe neto"), con cabeceras en chino, en Excel sin cabecera o con la cabecera más abajo.

## Ficheros

| Fichero | Qué es |
|---|---|
| `smartColumns.ts` | La detección. Sin dependencias. Exporta `smartColumns`, `isUsableMapping`, `isSummaryRowName`, `headerField`, `isGtin`, `normalizeHeader` y la lista `EXACT_HEADERS_ALBARAN`. |
| `smartColumns.test.ts` | Tests (Vitest): 107 casos. |
| `excels/*.xlsx` | Los 6 Excel de prueba. |
| `excels/esperado.json` | Qué columna es cada campo en cada Excel y qué líneas deben salir. |

## Cómo integrarlo

1. **Detección.** En el servicio de inventario (en el build, la función `M` de `inventoryService`, exportada
   como `d` y usada por `ExcelImportPage`), sustituir el cuerpo por:
   ```ts
   import { smartColumns } from "./smartColumns";
   return smartColumns(rows, parseMoney); // parseMoney = el parser de importes de la app (parse.ts)
   ```
   Devuelve lo mismo que la función original (`{ headerRowIndex, mapping, headers }`), así que la pantalla
   de importación no cambia: con código de barras y algún precio pasa directa a la revisión
   (`isUsableMapping` es el mismo criterio que ya usa la app); si no, la pantalla manual sale prerrellenada
   con este resultado. La pantalla manual también llama a esta función con una sola fila (la cabecera que
   elige el usuario), y ese caso está cubierto.
2. **Filas de totales.** Donde las filas se convierten en líneas (en el build, `St` de `ReviewSave`), al
   saltar las filas sin código de barras añadir: *sin código de barras y con un nombre que
   `isSummaryRowName` reconoce → no es un producto*. Antes, una fila "TOTAL" se importaba como producto.
3. **Tests.** Copiar `smartColumns.test.ts` y `excels/`. El test lleva una copia del parser de importes
   (`parseMoney`); en el código fuente, importar el real.

Este mismo cambio está aplicado y probado sobre el build en la rama `claude/bohao-mysql-credentials-b4ukuv`
(sin publicar). Comprobado: esta versión TypeScript da **exactamente el mismo resultado** que la integrada en
el build, en 5.000 hojas aleatorias y en los 7 Excel de prueba.

## Reglas

La detección combina dos pistas: el **texto de las cabeceras** y el **contenido de las columnas**. Cuando
discrepan, manda el contenido.

### 1. Fila de cabeceras

- Se busca en las **20 primeras filas** (así se salta el membrete: proveedor, CIF, número de albarán…).
- Cada celda se clasifica con las reglas de la tabla siguiente. La puntuación de una fila es el número de campos
  distintos que reconoce; **código de barras, precio e importe valen doble**.
- Gana la fila con más puntos, siempre que reconozca **al menos 2 campos**. Si ninguna llega, se considera que
  **no hay cabecera**.

Antes de comparar, el texto se normaliza: minúsculas, sin acentos, la puntuación (`. _ - / : ( ) , ;`) pasa a
espacio. "Dto. %" → `dto %`, "Cod.Barra" → `cod barra`, "C.B." → `c b`. Los caracteres chinos se conservan.

| Orden | Campo | Ejemplos que reconoce |
|---|---|---|
| 0 | *(cualquiera)* | Primero, las cabeceras exactas que ya reconocía la app (`EXACT_HEADERS_ALBARAN`). |
| 1 | Código de barras | EAN, EAN13, EAN8, GTIN, UPC, Barcode, Bar code, C.B., Cód. barras, Código de barras · 条码 条形码 国际码 商品码 |
| 2 | Referencia | Ref, Referencia, SKU, Cód. art., Código interno, Código proveedor, Modelo, Art · 货号 编号 编码 型号 款号 |
| 3 | Nombre | Descripción, Concepto, Denominación, Nombre, Detalle, Artículo, Producto, Item, Description · 名称 品名 商品 货品 产品 |
| 4 | Descuento | Dto, Dtos, Desc, Descuento, Discount, Rebaja · 折扣 |
| 5 | Importe | Importe, Total, Subtotal, Amount, Valor · 金额 总价 小计 合计 总额 |
| 6 | Precio final | Precio neto, P. Neto, Precio final, Net price, Pre.F · 折后 净价 实价 |
| 7 | Precio | Precio, Prec, PVP, P.U., Unit price, Tarifa, Coste, Costo · 单价 价格 进价 |
| 8 | Cantidad | Cant, Cantidad, Uds, Ud, Unid, Unidades, Qty, Quantity, Pcs, Piezas, Bultos, Cajas · 数量 件数 个数 |
| 9 | *ambiguo* | Código, Cod, Code · 代码 — puede ser código de barras o referencia: lo decide el contenido. |

El **orden importa**: gana la primera regla que encaja. Así, "Importe neto" es importe (regla 5) y no precio
neto, y "Descripción" es nombre (regla 3) antes de que la regla 4 pueda leer "desc" como descuento.

### 2. Contenido de cada columna

Se analizan hasta **300 filas de datos** (las que tienen al menos 2 celdas rellenas). Para cada columna se
calcula: proporción de **códigos de barras válidos**, de **números** y de **enteros**, de **texto** y la
**longitud media**. Los números en texto ("1.234,56") se leen con el parser de importes de la app.

### 3. Código de barras

- Un código es válido si tiene **8, 12, 13 o 14 dígitos con el dígito de control correcto** (como número o
  como texto).
- Si la cabecera señala una columna (código de barras o "Código") y **al menos el 50 %** de sus valores son
  códigos válidos, es esa.
- Si no, es la columna con más proporción de códigos válidos, si llega al 50 %.

### 4. Cantidad, precio, descuento e importe: la aritmética

- Entran en la búsqueda las columnas **numéricas** (≥ 60 % números), que no sean de códigos de barras.
- Se prueban todas las combinaciones *(cantidad, precio, importe)* con o sin columna de *descuento*, y se
  cuenta en qué proporción de filas se cumple **cantidad × precio × (1 − descuento / 100) = importe**
  (tolerancia: 2 céntimos o 1 %). Cuenta como válida si cuadra en **al menos el 60 %** de las filas.
- **Desempate** (en este orden de peso): más filas que cuadran; coincidir con lo que dicen las cabeceras; **no
  usar descuento si no hace falta** (así una columna «IVA %» no se toma por descuento); cantidades enteras.
- **Bruto, descuento y neto.** Si la combinación ganadora no usa descuento, se comprueba si su precio es en
  realidad el **neto**: si hay otra columna *U* y un descuento *D* con *U × (1 − D / 100) = precio* en al
  menos el 80 % de las filas (y algún descuento distinto de 0), entonces *precio* es el precio final, *U* el
  precio original y *D* el descuento. Si no, la cabecera decide si es precio final o precio.
- **Precio final en otra columna.** Si aún no hay precio final, se busca una columna *F* con
  *precio × (1 − dto) = F* y *cantidad × F = importe* en al menos el 60 % de las filas, siempre que la
  cabecera la llame "precio final" o que haya columna de descuento.
- **Sin aritmética que cuadre** (o sin datos): se usan las cabeceras, siempre que la columna sea numérica.

### 5. Nombre y referencia

- **Nombre:** la columna que dice la cabecera, si al menos el 50 % es texto. Si no, la columna de **texto más
  larga** (≥ 60 % texto) que quede libre.
- **Referencia:** solo por cabecera ("Ref", "SKU"… o un "Código" que no resultó ser el de barras). Sin cabecera
  no se puede distinguir y se deja sin asignar: es opcional.
- Cada columna se usa para **un solo campo**.

### 6. Sin fila de cabeceras

Los datos empiezan en la **primera fila con un código de barras válido**: así no se importan las filas de
membrete.

### 7. Filas de totales (al convertir filas en líneas)

Una fila **sin código de barras** cuyo nombre empieza por *Total, Subtotal, Suma, Base imponible, IVA, Importe
total, Total albarán, 合计, 总计 o 小计* se descarta (`isSummaryRowName`). Una fila con código de barras nunca se
descarta.

## Límites y rendimiento

| Límite | Valor | Por qué |
|---|---|---|
| Filas donde se busca la cabecera | 20 | Membrete típico: 3–8 filas. |
| Filas que se analizan | 300 | Suficiente para la estadística. |
| Filas de la búsqueda aritmética | 80 | Mantiene la búsqueda instantánea. |
| Columnas numéricas en la búsqueda | 12 | Las que la cabecera nombra primero; el resto, por proporción de números. |

40 columnas × 500 filas: menos de 50 ms.

## Qué no hace

- **No reconoce una columna de nombres corrida respecto a los números.** Eso no se ve con la aritmética.
- **No detecta la referencia sin cabecera.** No se puede distinguir de otros códigos internos.
- **No trata «PVP» como coste a propósito.** La regla 7 lo acepta como cabecera de precio, pero si no cuadra con
  cantidad × precio = importe, la aritmética elige la columna correcta.
- **La importación de inventario** (la otra pantalla de Excel, con stock y PVP) sigue con la detección antigua.
  Las reglas de cabecera se pueden reutilizar, pero no la aritmética, porque esa hoja no tiene importes.

## Resultados de las pruebas

| Prueba | Detección actual | Nueva |
|---|---|---|
| 6 Excel de prueba con todas las columnas bien | 1 de 6 | **6 de 6** |
| 3.000 Excel aleatorios: pide asignar a mano | 72,8 % | **0 %** |
| 3.000 Excel aleatorios: lo esencial bien (código, nombre, cantidad, importe y coste de cada línea) | 0,1 % | **100 %** |
| 3.000 Excel aleatorios: pasa directo con algo esencial mal | 0 % | **0 %** |
| Excel que la actual hacía bien y la nueva no | — | **0** |
| `sample-bm-order.xlsx` (repo de la app) | 9 líneas | 9 líneas, misma asignación |

En navegador (Chromium, la app completa): los 6 Excel de prueba entran solos y con todas las líneas exactas;
la versión actual pide asignación manual en 4 y, en el inglés, pasa directo **sin nombre ni importe**.

## Ejecutar los tests

```bash
npm install -D vitest xlsx      # si no están ya
npx vitest run smartColumns.test.ts
```

Comprobado con Vitest 2.1.8, TypeScript 5.6 (`strict`) y `xlsx` 0.18.5: 107 tests en verde y `tsc --noEmit`
sin errores.
