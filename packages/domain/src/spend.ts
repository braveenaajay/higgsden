export const SPEND_THRESHOLDS = [50, 80, 100] as const;

export function spendPercent(spendCents: number, capCents: number): number {
  return capCents <= 0 ? 100 : Math.floor((spendCents / capCents) * 100);
}

/** Thresholds the spend has reached, lowest first. */
export function thresholdsReached(spendCents: number, capCents: number): number[] {
  return SPEND_THRESHOLDS.filter((t) => spendCents * 100 >= capCents * t);
}

export function capReached(spendCents: number, capCents: number): boolean {
  return spendCents >= capCents;
}

export function billingPeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function periodStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export interface MeterInput {
  replicas: number;
  hours: number;
  replicaHourCostCents: number;
  replicaHourPriceCents: number;
}

/** Hosted compute for one environment over a metering window. */
export function computeUsage(input: MeterInput): { quantity: number; costCents: number; priceCents: number } {
  const quantity = input.replicas * input.hours;
  return {
    quantity,
    costCents: round2(quantity * input.replicaHourCostCents),
    priceCents: round2(quantity * input.replicaHourPriceCents),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
