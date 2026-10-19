import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns'

export const iso = (d: Date) => format(d, 'yyyy-MM-dd')
export const parse = (s: string) => parseISO(s)
export const addDaysIso = (s: string, n: number) => iso(addDays(parseISO(s), n))
export const daysBetween = (a: string, b: string) => differenceInCalendarDays(parseISO(b), parseISO(a))
export const mondayOf = (s: string) => iso(startOfWeek(parseISO(s), { weekStartsOn: 1 }))
/** 0 = segunda ... 6 = domingo */
export const weekdayOf = (s: string) => (parseISO(s).getDay() + 6) % 7
export const today = () => iso(new Date())
