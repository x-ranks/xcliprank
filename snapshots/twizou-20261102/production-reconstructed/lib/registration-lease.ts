import { FreeCuratedError } from "./fxtwitter-curated";

export type RegistrationReceipt = { owner: string; page: number; outcome: "complete" | "partial" | null;
  ready: boolean; publication: {saved:number;promoted:number;excluded:number;duplicates:number} };
export type RegistrationLease = { owner: string; expiresAt: number };
export const REGISTRATION_LEASE_MS = 180000;
export const validRegistrationOwner = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{32}$/.test(v);
export function validRegistrationFields(a: {initialReady?:unknown;initialPageConfirmed?:unknown;initialHistoryOutcome?:unknown;registrationLease?:any;registrationReceipt?:any}) {
  const l=a.registrationLease,r=a.registrationReceipt;
  return (a.initialReady===undefined||typeof a.initialReady==="boolean") &&
    (a.initialPageConfirmed===undefined||typeof a.initialPageConfirmed==="boolean") &&
    (a.initialHistoryOutcome===undefined||a.initialHistoryOutcome==="complete"||a.initialHistoryOutcome==="partial") &&
    (l===undefined||!!l&&validRegistrationOwner(l.owner)&&Number.isSafeInteger(l.expiresAt)&&l.expiresAt>=0) &&
    (r===undefined||!!r&&validRegistrationOwner(r.owner)&&Number.isSafeInteger(r.page)&&r.page>=0&&r.page<=30&&
      [null,"complete","partial"].includes(r.outcome)&&typeof r.ready==="boolean"&&r.ready===(r.outcome!==null)&&
      !!r.publication&&[r.publication.saved,r.publication.promoted,r.publication.excluded,r.publication.duplicates].every(n=>Number.isSafeInteger(n)&&n>=0));
}
export function registrationLeaseActive(a:{registrationLease?:RegistrationLease},now:number) {
  return !!a.registrationLease&&a.registrationLease.expiresAt>now;
}
export function requireRegistrationOwner(a:{registrationLease?:RegistrationLease},owner:unknown,now:number) {
  if(!validRegistrationOwner(owner)||!registrationLeaseActive(a,now)||a.registrationLease!.owner!==owner)
    throw new FreeCuratedError(409,"初回取得の処理枠が切れました。取得位置を保持して再開してください。");
}
