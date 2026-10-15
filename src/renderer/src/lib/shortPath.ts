export function shortPath(value: string): string {
  if (value.length <= 48) return value
  return `…${value.slice(-48)}`
}
