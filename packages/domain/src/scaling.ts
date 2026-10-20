/** Requests per second one replica serves before the HPA adds another, for the simulated load model. */
export const REQUESTS_PER_REPLICA = 50;

export interface ScalingState {
  currentReplicas: number;
  desiredReplicas: number;
  minReplicas: number;
  maxReplicas: number;
  /** Set while the Agency is at its spend cap. */
  pinnedMaxReplicas: number | null;
  scaledToZero: boolean;
}

export function desiredReplicasForLoad(requestsPerSecond: number, perReplica = REQUESTS_PER_REPLICA): number {
  return Math.max(0, Math.ceil(requestsPerSecond / perReplica));
}

export function effectiveMaxReplicas(state: Pick<ScalingState, 'maxReplicas' | 'pinnedMaxReplicas'>): number {
  return state.pinnedMaxReplicas ?? state.maxReplicas;
}

/**
 * One HPA step. The tier sets the bounds. The spend cap only lowers the ceiling to what is already running,
 * so reaching the cap never removes a replica that is serving traffic.
 */
export function nextReplicas(state: ScalingState): number {
  if (state.scaledToZero) return 0;
  const target = Math.max(state.minReplicas, state.desiredReplicas);
  return Math.min(target, effectiveMaxReplicas(state));
}

/** Preview environments with no traffic for longer than the tier allows scale to zero. */
export function shouldScaleToZero(input: { environment: string; lastActivityAt: Date | null; idleMinutes: number; now?: Date }): boolean {
  if (input.environment !== 'preview' || !input.lastActivityAt) return false;
  const now = input.now ?? new Date();
  return now.getTime() - input.lastActivityAt.getTime() > input.idleMinutes * 60_000;
}
