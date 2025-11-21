import { DateTime } from 'luxon';

export const MYT = 'Asia/Kuala_Lumpur';

export function getMalaysiaDate(date: Date = new Date()): DateTime {
  return DateTime.fromJSDate(date).setZone(MYT);
}

export function toUTCDate(date: DateTime): Date {
  return date.toUTC().toJSDate();
}