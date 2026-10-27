Recursos de pdf.js 6.2.108 (paquete `pdfjs-dist@6.2.108`, copiados sin modificar).

- `cmaps/`: tablas de caracteres para PDF con fuentes chinas, japonesas o coreanas no incrustadas.
- `standard_fonts/`: fuentes estándar para PDF que no incrustan las suyas.
- `wasm/`: decodificadores de imágenes JBIG2 (escáneres en blanco y negro) y JPEG 2000.
- `iccs/`: perfil de color para PDF en CMYK.

La app los pasa a `getDocument` (cMapUrl, standardFontDataUrl, wasmUrl, iccUrl). Si se actualiza
pdf.js en el código fuente, hay que copiar los de la versión nueva (en el código fuente van en `public/pdfjs/`).
Licencias: `LICENSE` (pdf.js, Apache-2.0) y las de cada carpeta.
