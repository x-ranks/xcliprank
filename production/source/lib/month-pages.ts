// Shared names for the monthly ranking pages (month is "YYYY-MM", Japan time).
export const monthHref = (month: string) => `/months/${month}`;
export const monthLabel = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
