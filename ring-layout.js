export function ringPresentation(partCount) {
  if (!Number.isInteger(partCount) || partCount <= 0) return "empty";
  return partCount === 1 ? "single" : "multiple";
}
