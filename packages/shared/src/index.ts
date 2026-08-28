export type ISODateTime = string;

export interface RequestContext {
  requestId: string;
  chatStartedAtUtc: ISODateTime;
  userTimezone: string;
}

export function createRequestId(): string {
  return crypto.randomUUID();
}
