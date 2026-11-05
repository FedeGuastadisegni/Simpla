// Lee el texto de un PDF en memoria. El ArrayBuffer lo tira quien llama.
// pdf.js está vendorizado: no sale a un CDN. No guarda el archivo.

import { getDocument, GlobalWorkerOptions, OPS } from "./vendor/pdfjs/pdf.min.mjs";

GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

function lineFromGlyphs(glyphs) {
  if (!Array.isArray(glyphs)) return "";
  let text = "";
  for (const glyph of glyphs) {
    if (typeof glyph === "number") {
      if (glyph < -100) text += " ";
      continue;
    }
    text += glyph?.unicode || "";
  }
  return text.replace(/\s+/g, " ").trim();
}

export async function textFromPdf(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const task = getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index);
      const ops = await page.getOperatorList();
      const lines = [];
      ops.fnArray.forEach((fn, opIndex) => {
        if (fn !== OPS.showText && fn !== OPS.showSpacedText) return;
        const line = lineFromGlyphs(ops.argsArray[opIndex]?.[0]);
        if (line) lines.push(line);
      });
      pages.push(lines.join("\n"));
      page.cleanup();
    }
    return pages.join("\n");
  } finally {
    await doc.destroy();
  }
}
