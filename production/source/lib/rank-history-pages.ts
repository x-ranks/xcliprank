// Shared names for the ranking archive pages (day is "YYYY-MM-DD", Japan time).
export const rankDayHref = (day: string) => `/ranking/history/${day}`;
export const rankDayLabel = (day: string) => `${Number(day.slice(0, 4))}年${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
