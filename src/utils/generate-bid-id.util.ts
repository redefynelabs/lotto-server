export function generateUniqueBidId(slotCode: string, phone: string, payload: any) {
  if (payload.type === 'LD') {
    return `${slotCode}#${phone}#${payload.number}#${payload.count}`;
  }
  if (payload.type === 'JP') {
    return `${slotCode}#${phone}#${payload.jpNumbers.join('-')}`;
  }
}
