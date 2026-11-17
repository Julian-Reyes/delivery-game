import type { InputSource, RawInput } from '../input/actions';
import type { Pose } from '../bike/rider';
import { BIKE_TURN_RADIUS } from '../world/roads/graph';
import type { RoadGraph, RoadPoint } from '../world/roads/graph';
import { findRoute } from '../world/roads/route';

/**
 * Developer tool that rides the bike along a route on the road graph, for checking that
 * every road can actually be ridden: it reports whether it arrived, how far it strayed
 * from the centreline, and where it got stuck. It is an input source like the keyboard,
 * so the game sees nothing but ordinary throttle, brake and steering.
 */

const LOOK_AHEAD = 7;
const STEER_GAIN = 2.2;
const TOP_SPEED = 20;
const STUCK_SECONDS = 3;
const MAX_SECONDS = 400;

export interface RideReport {
  arrived: boolean;
  seconds: number;
  metres: number;
  /** Furthest the bike got from the route's centreline. */
  maxOffset: number;
  /** Longest single time off the ground, in seconds: crests that throw the bike. */
  longestAir: number;
  stuckAt: { x: number; z: number } | null;
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export class Autopilot implements InputSource {
  private path: RoadPoint[] = [];
  private cursor = 0;
  private elapsed = 0;
  private stillFor = 0;
  private maxOffset = 0;
  private lastX = 0;
  private lastZ = 0;
  private finish: ((report: RideReport) => void) | null = null;
  private lastTime = 0;
  private air = 0;
  private longestAir = 0;

  constructor(
    private readonly graph: RoadGraph,
    private readonly pose: Pose,
    private readonly speed: () => number,
    private readonly airborne: () => boolean,
  ) {}

  /** Ride from where the bike is to the road nearest (x, z). */
  ride(x: number, z: number): Promise<RideReport> {
    const route = findRoute(this.graph, this.pose.x, this.pose.z, x, z, 'ride');
    if (!route) return Promise.reject(new Error('No route there'));

    // Stitch the edges into one centreline in travel order, each edge oriented by the node
    // it shares with its neighbour.
    const ids = route.edges;
    const points: RoadPoint[] = [];
    ids.forEach((id, k) => {
      const edge = this.graph.getEdge(id);
      let forward: boolean;
      const next = ids[k + 1];
      const previous = ids[k - 1];
      if (next !== undefined) {
        const following = this.graph.getEdge(next);
        forward = edge.to === following.from || edge.to === following.to;
      } else if (previous !== undefined) {
        const before = this.graph.getEdge(previous);
        forward = edge.from === before.from || edge.from === before.to;
      } else {
        forward = route.to.along >= route.from.along;
      }
      points.push(...(forward ? edge.points : [...edge.points].reverse()));
    });
    this.path = points;
    let nearest = Infinity;
    points.forEach((p, i) => {
      const d = Math.hypot(p.x - this.pose.x, p.z - this.pose.z);
      if (d < nearest) {
        nearest = d;
        this.cursor = i;
      }
    });
    this.elapsed = 0;
    this.stillFor = 0;
    this.maxOffset = 0;
    this.air = 0;
    this.longestAir = 0;
    this.lastX = this.pose.x;
    this.lastZ = this.pose.z;
    this.lastTime = performance.now();
    return new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  read(out: RawInput): void {
    if (!this.finish || this.path.length === 0) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.elapsed += dt;

    const { x, z, heading } = this.pose;
    // Advance the cursor to the nearest point ahead.
    let best = this.cursor;
    let bestDistance = Infinity;
    for (let i = this.cursor; i < Math.min(this.path.length, this.cursor + 30); i++) {
      const p = this.path[i];
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    this.cursor = best;
    this.maxOffset = Math.max(this.maxOffset, bestDistance);
    this.air = this.airborne() ? this.air + dt : 0;
    this.longestAir = Math.max(this.longestAir, this.air);

    const last = this.path[this.path.length - 1];
    if (last && this.cursor >= this.path.length - 2 && Math.hypot(last.x - x, last.z - z) < 4) {
      this.end(true, null);
      return;
    }

    // Aim at a point a little way ahead along the path.
    let target = this.path[this.cursor];
    let travelled = 0;
    for (let i = this.cursor + 1; i < this.path.length && travelled < LOOK_AHEAD; i++) {
      const a = this.path[i - 1];
      const b = this.path[i];
      if (!a || !b) break;
      travelled += Math.hypot(b.x - a.x, b.z - a.z);
      target = b;
    }
    if (!target) return;
    const wanted = Math.atan2(target.x - x, target.z - z);
    const error = wrapAngle(wanted - heading);
    out.steer = Math.max(-1, Math.min(1, -error * STEER_GAIN));

    // Slow for the tightest curve in the next stretch.
    let tightest = Infinity;
    for (let i = this.cursor + 2; i < Math.min(this.path.length - 2, this.cursor + 20); i += 2) {
      const a = this.path[i - 2];
      const b = this.path[i];
      const c = this.path[i + 2];
      if (!a || !b || !c) continue;
      const turn = Math.abs(
        wrapAngle(Math.atan2(c.x - b.x, c.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z)),
      );
      const span = Math.hypot(c.x - a.x, c.z - a.z) / 2;
      if (turn > 1e-3) tightest = Math.min(tightest, span / turn);
    }
    const safe = Math.min(TOP_SPEED, Math.max(BIKE_TURN_RADIUS, tightest) * 1.5);
    const speed = this.speed();
    out.throttle = speed < safe ? 1 : 0;
    out.brake = speed > safe + 2 ? 1 : 0;

    // Stuck: hardly moving for a while.
    const moved = Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;
    this.stillFor = moved < 0.02 ? this.stillFor + dt : 0;
    if (this.stillFor > STUCK_SECONDS || this.elapsed > MAX_SECONDS) this.end(false, { x, z });
  }

  dispose(): void {
    this.finish = null;
  }

  private end(arrived: boolean, stuckAt: { x: number; z: number } | null): void {
    let metres = 0;
    for (let i = 1; i <= this.cursor; i++) {
      const a = this.path[i - 1];
      const b = this.path[i];
      if (a && b) metres += Math.hypot(b.x - a.x, b.z - a.z);
    }
    const finish = this.finish;
    this.finish = null;
    this.path = [];
    finish?.({
      arrived,
      seconds: Math.round(this.elapsed),
      metres: Math.round(metres),
      maxOffset: Math.round(this.maxOffset * 10) / 10,
      longestAir: Math.round(this.longestAir * 100) / 100,
      stuckAt,
    });
  }
}
