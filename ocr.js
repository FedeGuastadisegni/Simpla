// OCR de una captura, solo en este teléfono.
// La imagen no se sube ni se guarda: Tesseract corre en el navegador
// y el texto se descarta después de parsear. El modelo de idioma se
// baja la primera vez; la foto no sale.

const OCR_MODULE = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js";

export async function textFromImage(file) {
  const { createWorker } = await import(OCR_MODULE);
  const worker = await createWorker("spa", 1, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js",
    langPath: "https://tessdata.projectnaptha.com/4.0.0",
  });
  try {
    const result = await worker.recognize(file);
    return String(result?.data?.text || "");
  } finally {
    await worker.terminate();
  }
}
