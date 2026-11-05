// Los textos no guardan números largos (tarjeta, cuenta, etc.).
// Una seguidilla de 8 dígitos o más, con espacios o guiones, se reemplaza por "••••".

const LONG_NUMBER = /\d(?:[ \-]*\d){7,}/g;

export function redactLongNumbers(value) {
  return String(value ?? "").replace(LONG_NUMBER, "••••");
}
