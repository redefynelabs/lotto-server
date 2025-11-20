export function generateSlotId(type: 'LD' | 'JP', index: number) {
  const prefix = type === 'LD' ? 'LD' : 'JP';
  return `${prefix}${String(index).padStart(4, '0')}`;
}
