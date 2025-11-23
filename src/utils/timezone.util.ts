import { DateTime } from 'luxon';

export const MYT = 'Asia/Kuala_Lumpur';

export function getMalaysiaDate(date?: Date): DateTime {
  // interpret the incoming JS Date as UTC
  return DateTime.fromJSDate(date ?? new Date(), { zone: 'UTC' })
    .setZone(MYT); // convert to Malaysia time
}

export function toUTCDate(dt: DateTime): Date {
  return dt.setZone('UTC', { keepLocalTime: false }).toJSDate();
}
