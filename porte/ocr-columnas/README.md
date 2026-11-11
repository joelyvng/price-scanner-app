# Corrección de columnas desplazadas en la lectura de albaranes con IA

Código para portar al repositorio fuente de la app.

**Por qué:** con una foto mala, la IA a veces no lee un valor de una columna (por ejemplo, una cantidad) y
"rellena" con el de la línea siguiente. Desde ahí, toda la columna queda corrida una posición:

```
Albarán real:   TAZA 12 · VASO 6 · PLATO 24 · JARRA 4 · CESTA 10 · VELA 36
Lee la IA:      TAZA 12 · VASO 6 · PLATO 4  · JARRA 10 · CESTA 36 · VELA —
Con la corrección: TAZA 12 · VASO 6 · PLATO 24 · JARRA 4 · CESTA 10 · VELA 36   (4 líneas marcadas para revisar)
```

Esta corrección estuvo publicada en la tienda (commit `6d7da00`) y **se perdió con la versión compilada desde
el código fuente el 11/11** (`29a65ad`), que no la incluye. Esta carpeta sirve para recuperarla en el código
fuente.

## Ficheros

| Fichero | Qué es |
|---|---|
| `fixColumnShift.ts` | La corrección. Sin dependencias. Exporta `fixColumnShift` y `lineIsConsistent`. |
| `fixColumnShift.test.ts` | Tests (Vitest): 16 casos, 4 de ellos con miles de albaranes aleatorios. |
| `escenarios.json` | 7 escenarios con nombre: lo que devuelve la IA, lo correcto y qué líneas deben llevar nota. El primero es el caso que describió el usuario. |

## Cómo integrarlo

En el código que recibe la respuesta de la función de IA (`ocr-albaran`) y la convierte en líneas de
albarán (en el build, la función `g` de `OcrLoader`, común a foto, PDF y texto):

1. **Antes** de convertir cada línea, pasar el array de líneas de la IA por la corrección:
   ```ts
   import { fixColumnShift } from "./fixColumnShift";
   const lines = fixColumnShift(Array.isArray(response.lines) ? response.lines : []);
   ```
   Trabaja sobre los **números tal como los devuelve la IA** (`quantity`, `unitPrice`, `discountPercent`,
   `finalUnitPrice`, `lineTotal`), antes de pasarlos a texto con coma y antes de la corrección de precios por
   pack (×10/×100/×1000), que sigue aplicándose después, línea a línea, como ahora.
2. **Después** de validar cada línea (la validación reescribe la lista de avisos), añadir la nota si la hay:
   ```ts
   const draft = validateLine({ ... });          // en el build: R({ ... }) → ae()
   if (line._note) draft.issues.push(line._note); // la línea sale con "!" y el motivo
   ```
   Así el usuario ve qué se ha corregido y lo revisa antes de guardar.

Comprobado: esta versión TypeScript da **exactamente el mismo resultado** que la que estuvo publicada en la
tienda, en 20.000 albaranes aleatorios (con desplazamientos, dígitos mal leídos, valores vacíos y ruido).

## Reglas

### 1. Cuándo cuadra una línea (`lineIsConsistent`)

- **cantidad × precio efectivo = importe**, con tolerancia de **2 céntimos o 1 %**. El precio efectivo es el
  precio final si existe; si no, precio × (1 − descuento / 100).
- Si la línea tiene **precio y precio final**, además **precio × (1 − descuento / 100) = precio final**
  (tolerancia de **1,1 céntimos o 1 %**). Esta segunda cuenta es la que permite detectar un desplazamiento en
  la columna de precio cuando hay precio final.
- Solo cuentan valores numéricos **positivos**. El descuento se usa solo si está entre 0 y 100.

### 2. Hipótesis que se prueban

Para cada columna corregible —**cantidad, precio, precio final, importe**— y cada línea de inicio *k*:

- **Se perdió un valor en *k*** y los de debajo subieron: se bajan una posición y la línea *k* queda sin valor.
- **Se coló un valor de más en *k*** y los de debajo bajaron: se suben una posición y la última línea queda sin
  valor.

Una columna se prueba solo si tiene al menos 2 valores. El descuento y los nombres no se mueven.

### 3. Deducir el valor que falta

En la línea que queda sin valor, se calcula a partir de las otras columnas:

| Falta | Se deduce como | Condición |
|---|---|---|
| cantidad | importe ÷ precio efectivo | tiene que salir un entero (±0,02) |
| importe | cantidad × precio efectivo | — |
| precio (con precio final) | final ÷ (1 − descuento) | — |
| precio o precio final | importe ÷ cantidad | — |

Si no se puede deducir, queda vacío y la validación de la app marca la línea.

### 4. Cuándo se acepta una hipótesis

- Debe hacer cuadrar **al menos 2 líneas más** que la lectura de la IA.
- **Nunca** puede estropear una línea que ya cuadraba.
- Entre las que cumplen, gana la que más líneas hace cuadrar.
- Se repite **como mucho 2 veces**, así que se pueden corregir dos columnas corridas en el mismo albarán.
- Con **menos de 3 líneas** no se hace nada.

### 5. Notas para el usuario

Cada línea tocada lleva `_note` (varias notas se separan con «·»):

- `Columna «cantidad» desplazada en la lectura: corregida automáticamente, revísala`
- `«cantidad» no se leyó: deducido de las otras columnas, revísalo`

## Resultados de las pruebas

20.000 albaranes simulados con una columna corrida en cualquier punto:

| Líneas afectadas por el desplazamiento | Arreglados del todo |
|---|---|
| 3 o más | **100 %** |
| las 2 últimas | 52 % |
| solo la última | 0 % (por diseño: un solo valor que falta no es un desplazamiento; la validación de la app ya marca esa línea) |

En todos los casos: **0 % peor** que la lectura de la IA y **0 arreglos a medias** (o queda perfecto o no se
toca). Lecturas correctas: **100 % intactas**. Un dígito mal leído: **nunca** se toma por un desplazamiento.
Dos columnas corridas a la vez: ≥ 95 % arregladas del todo.

En una medición anterior (20.000 albaranes con desplazamientos hacia arriba y hacia abajo), las líneas erróneas
que pasaban **sin ningún aviso** bajaron de 6.786 a 1.062.

En navegador (Chromium, la app completa, con la IA simulada), el caso del usuario queda exacto y con las 4
notas.

## Qué no hace

- **Si lo que se corre es la columna de nombres** respecto a los números, las cuentas siguen cuadrando y no se
  detecta. Eso hay que arreglarlo en la instrucción de la función `ocr-albaran`: leer fila a fila y devolver
  `null` en las celdas ilegibles, en vez de rellenar con la siguiente.
- **No adivina valores** que la IA no leyó y que no se pueden deducir con la aritmética.
- **Necesita que la IA devuelva números**, no textos. Es lo que ya hace la app: los valores que no son números se
  descartan.

## Ejecutar los tests

```bash
npm install -D vitest   # si no está ya
npx vitest run fixColumnShift.test.ts
```

Comprobado con Vitest 2.1.8 y TypeScript 5.6 (`strict`): 16 tests en verde y `tsc --noEmit` sin errores.
