export const MAX_INSERT_TABLE_DIMENSION = 50;

export function tableDimension(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const dimension = Number(value);
  return Number.isInteger(dimension) && dimension >= 1 && dimension <= MAX_INSERT_TABLE_DIMENSION
    ? dimension
    : null;
}

export function tableCellCount(rows: string, columns: string): number {
  return (tableDimension(rows) ?? 0) * (tableDimension(columns) ?? 0);
}
