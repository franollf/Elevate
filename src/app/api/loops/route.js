// GET /api/loops?lat=..&lng=..&distance=5
// Builds several running routes (loops and out-and-backs) that start and
// finish at (lat, lng), each close to the target distance, and returns them
// with elevation stats + profile.
import polyline from "@mapbox/polyline";
import { destinationPoint, haversineKm } from "@/lib/geo";

export const maxDuration = 60;

const KEY =
  process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// Routing: Valhalla (OpenStreetMap) because its pedestrian costing can avoid
// hills and prefer footpaths (e.g. the Vancouver seawall); Google Directions
// only optimises for shortest path. Defaults to the free public FOSSGIS server
// (fair use only) — set VALHALLA_URL to point at your own instance.
const VALHALLA_URL = (process.env.VALHALLA_URL || "https://valhalla1.openstreetmap.de").replace(/\/$/, "");
const PEDESTRIAN_COSTING = {
  use_hills: 0.0, // 0 = avoid hills as much as possible
  walkway_factor: 0.6, // prefer dedicated footpaths / seawall over roads
  sidewalk_factor: 0.9,
  alley_factor: 2.0,
  driveway_factor: 5.0,
  step_penalty: 30, // seconds; runners don't want stairs
  max_hiking_difficulty: 1, // no proper hiking trails
};

// Candidate shapes. Loops explore the area; out-and-backs (go half the
// distance, return the same way) are what finds flat shoreline/greenway runs
// like the seawall, since a circle from a shoreline start is half over water
// and its inland waypoints drag the route uphill.
// The public Valhalla server answers ~1 request/second per client, so the
// number of routing calls is what sets search time (~13 calls ≈ 13 s).
const LOOP_BEARINGS = 3;
const TURNAROUND_BEARINGS = 16; // screened cheaply (1 matrix + 1 elevation call)
const OUT_AND_BACK_ROUTES = 8; // how many of those get fully routed
const TURNAROUND_REACH = [0.7, 0.85, 1.0, 1.2]; // × estimated straight-line reach
const MAX_ITER = 2; // routing calls per loop to tune its size
const CONCURRENCY = 4;
const GOOD_ENOUGH = 0.06; // stop tuning within 6% of target
const ACCEPT = 0.15; // discard loops more than 15% off target
const ROAD_FACTOR = 1.35; // walking paths are ~35% longer than the ideal circle

// ---------- Routing ----------

/** Run async tasks with at most `limit` in flight. */
async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    })
  );
  return results;
}

const vLoc = (p) => ({ lat: +p.lat.toFixed(6), lon: +p.lng.toFixed(6) });

async function valhallaPost(endpoint, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${VALHALLA_URL}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Elevate running-loop finder" },
      body: JSON.stringify({
        ...body,
        costing: "pedestrian",
        costing_options: { pedestrian: PEDESTRIAN_COSTING },
        units: "kilometers",
      }),
      cache: "no-store",
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    const data = await res.json().catch(() => null);
    return res.ok ? data : null; // e.g. no route between points
  }
  throw new Error("Routing server is busy — try again in a minute.");
}

/** Walking distance (km, hill-averse) from `origin` to each target; null if unreachable. */
async function walkingDistances(origin, targets) {
  const data = await valhallaPost("sources_to_targets", {
    sources: [vLoc(origin)],
    targets: targets.map(vLoc),
  });
  const row = data?.sources_to_targets?.[0] ?? [];
  return targets.map((_, j) => row[j]?.distance ?? null);
}

/** Route through `stops` ([{lat, lng, type}]) with hill-averse walking costing. */
async function valhallaRoute(stops) {
  const data = await valhallaPost("route", {
    locations: stops.map((p) => ({ ...vLoc(p), type: p.type ?? "break" })),
    directions_type: "none",
  });
  if (!data?.trip) return null;
  const path = [];
  for (const leg of data.trip.legs) {
    for (const [lat, lng] of polyline.decode(leg.shape, 6)) {
      const last = path[path.length - 1];
      if (!last || last.lat !== lat || last.lng !== lng) path.push({ lat, lng });
    }
  }
  return { distanceKm: data.trip.summary.length, startAddress: null, path };
}

/** `n` points evenly spaced along the path, each tagged with its distance (km). */
function resample(path, n) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversineKm(path[i - 1], path[i]));
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    while (j < path.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j];
    const t = seg > 0 ? Math.min(1, Math.max(0, (target - cum[j]) / seg)) : 0;
    out.push({
      lat: path[j].lat + (path[j + 1].lat - path[j].lat) * t,
      lng: path[j].lng + (path[j + 1].lng - path[j].lng) * t,
      d: target,
    });
  }
  return out;
}

const MAX_ELEVATION_POINTS = 512; // Elevation API limit per request

/** Elevation (m) at each point, in one Google request. */
async function getElevations(points) {
  const enc = polyline.encode(points.map((p) => [p.lat, p.lng]));
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/elevation/json?locations=enc:${encodeURIComponent(enc)}&key=${KEY}`,
    { cache: "no-store" }
  );
  const data = await res.json();
  if (data.status !== "OK") throw new Error(`Elevation API: ${data.status}`);
  return data.results.map((r) => r.elevation);
}

async function getElevationProfile(path, distanceKm) {
  // Our own evenly spaced points along the real path (~every 20 m, max 512),
  // so samples follow the route exactly and stay within the API's point limit.
  const n = Math.max(50, Math.min(MAX_ELEVATION_POINTS, Math.round((distanceKm * 1000) / 20)));
  const pts = resample(path, n);
  const enc = polyline.encode(pts.map((p) => [p.lat, p.lng]));
  const url =
    "https://maps.googleapis.com/maps/api/elevation/json" +
    `?locations=enc:${encodeURIComponent(enc)}&key=${KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (data.status !== "OK") {
    throw new Error(`Elevation API: ${data.status} ${data.error_message ?? ""}`.trim());
  }
  return data.results.map((r, i) => ({
    lat: pts[i].lat,
    lng: pts[i].lng,
    elevation: r.elevation,
    d: pts[i].d,
  }));
}

// ---------- Loop construction ----------

/** Three waypoints on a circle that passes through the start point. */
function loopWaypoints(start, radiusKm, bearing, clockwise) {
  const center = destinationPoint(start, radiusKm, bearing);
  const startAngle = bearing + 180; // start sits opposite the bearing
  const dir = clockwise ? 1 : -1;
  return [1, 2, 3].map((i) =>
    destinationPoint(center, radiusKm, startAngle + dir * i * 90)
  );
}

async function findLoop(start, targetKm, bearing, clockwise) {
  let radius = targetKm / ROAD_FACTOR / (2 * Math.PI);
  let best = null;
  for (let i = 0; i < MAX_ITER; i++) {
    const waypoints = loopWaypoints(start, radius, bearing, clockwise);
    const dir = await valhallaRoute([
      start,
      ...waypoints.map((w) => ({ ...w, type: "through" })),
      start,
    ]);
    if (!dir) break;
    const err = Math.abs(dir.distanceKm - targetKm) / targetKm;
    if (!best || err < best.err) best = { ...dir, type: "loop", waypoints, err, bearing };
    if (err < GOOD_ENOUGH) break;
    radius *= Math.min(2, Math.max(0.5, targetKm / dir.distanceKm));
  }
  return best && best.err <= ACCEPT ? best : null;
}

/**
 * Pick one turnaround per bearing whose walking distance is ~half the target,
 * using a single distance-matrix call over a grid of candidate points.
 */
async function pickTurnarounds(start, targetKm, bearings, keep) {
  const half = targetKm / 2;
  const reach = half / ROAD_FACTOR;
  const grid = bearings.flatMap((bearing) =>
    TURNAROUND_REACH.map((f) => ({ bearing, point: destinationPoint(start, reach * f, bearing) }))
  );
  // One routing-server call for all walking distances, one Google call for
  // all elevations (start first).
  const [dists, elevs] = await Promise.all([
    walkingDistances(start, grid.map((g) => g.point)),
    getElevations([start, ...grid.map((g) => g.point)]).catch(() => null),
  ]);
  // Ocean points report sea-floor depth; they snap to the shoreline, so treat as 0 m.
  const elevAt = (j) => (elevs ? Math.max(0, elevs[j]) : 0);
  const startElev = elevAt(0);

  const perBearing = bearings
    .map((bearing) => {
      let best = null;
      grid.forEach((g, j) => {
        if (g.bearing !== bearing || dists[j] == null) return;
        const err = Math.abs(2 * dists[j] - targetKm) / targetKm;
        if (!best || err < best.err) best = { ...g, err, climb: Math.abs(elevAt(j + 1) - startElev) };
      });
      return best && best.err <= ACCEPT ? best : null;
    })
    .filter(Boolean);
  // Turnarounds near the start's elevation are the likeliest flat runs.
  return perBearing.sort((a, b) => a.climb - b.climb).slice(0, keep);
}

/** Route out to the turnaround, then come back the same way. */
async function buildOutAndBack(start, targetKm, turn) {
  const leg = await valhallaRoute([start, turn.point]);
  if (!leg) return null;
  const err = Math.abs(2 * leg.distanceKm - targetKm) / targetKm;
  if (err > ACCEPT) return null;
  const end = leg.path[leg.path.length - 1];
  return {
    distanceKm: 2 * leg.distanceKm,
    startAddress: null,
    path: [...leg.path, ...[...leg.path].reverse().slice(1)],
    type: "out-and-back",
    turnaround: end,
    waypoints: [end],
    err,
    bearing: turn.bearing,
  };
}

/** Fraction of route A's points that lie within ~60 m of route B. */
function overlap(a, b) {
  const step = Math.max(1, Math.floor(a.path.length / 40));
  const bStep = Math.max(1, Math.floor(b.path.length / 200));
  const bPts = b.path.filter((_, i) => i % bStep === 0);
  let near = 0;
  let total = 0;
  for (let i = 0; i < a.path.length; i += step) {
    total++;
    if (bPts.some((q) => haversineKm(a.path[i], q) < 0.06)) near++;
  }
  return near / total;
}

/** Biggest climb or descent grade (%) over ~100 m windows. */
function steepestGrade(profile) {
  let max = 0;
  let j = 0;
  for (let i = 0; i < profile.length; i++) {
    while (j < profile.length && profile[j].d - profile[i].d < 0.1) j++;
    if (j >= profile.length) break;
    const run = (profile[j].d - profile[i].d) * 1000;
    const grade = (Math.abs(profile[j].elevation - profile[i].elevation) / run) * 100;
    if (grade > max) max = grade;
  }
  return max;
}

/**
 * Elevation data is noisy by a few metres, worst along shorelines and cliffs
 * (e.g. the Vancouver seawall under the Stanley Park cliffs). Smooth over ~200 m, then only count a climb or
 * descent once it exceeds HYSTERESIS_M, as GPS watches/Strava do.
 */
const SMOOTH_RADIUS_M = 100;
const HYSTERESIS_M = 3;

function smoothProfile(profile) {
  let a = 0;
  let b = 0;
  let sum = 0;
  return profile.map((p, i) => {
    while (b < profile.length && profile[b].d - p.d <= SMOOTH_RADIUS_M / 1000) sum += profile[b++].elevation;
    while (p.d - profile[a].d > SMOOTH_RADIUS_M / 1000) sum -= profile[a++].elevation;
    return { ...p, elevation: sum / (b - a), raw: profile[i].elevation };
  });
}

function elevationStats(profile) {
  const e = profile.map((p) => p.elevation);
  let gain = 0;
  let loss = 0;
  let ref = e[0];
  for (const x of e) {
    if (x > ref + HYSTERESIS_M) {
      gain += x - ref;
      ref = x;
    } else if (x < ref - HYSTERESIS_M) {
      loss += ref - x;
      ref = x;
    }
  }
  const els = profile.map((p) => p.elevation);
  return {
    gain: Math.round(gain),
    loss: Math.round(loss),
    min: Math.round(Math.min(...els)),
    max: Math.round(Math.max(...els)),
    steepest: Math.round(steepestGrade(profile) * 10) / 10,
  };
}

// ---------- Handler ----------

export async function GET(request) {
  if (!KEY) {
    return Response.json({ error: "Server is missing GOOGLE_MAPS_API_KEY" }, { status: 500 });
  }
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const distance = Number(searchParams.get("distance"));
  if (
    !Number.isFinite(lat) || Math.abs(lat) > 90 ||
    !Number.isFinite(lng) || Math.abs(lng) > 180 ||
    !Number.isFinite(distance) || distance < 1 || distance > 42
  ) {
    return Response.json({ error: "Invalid lat, lng or distance (1–42 km)" }, { status: 400 });
  }
  const start = { lat, lng };

  try {
    const offset = Math.random() * 360;
    const turnarounds = await pickTurnarounds(
      start,
      distance,
      Array.from({ length: TURNAROUND_BEARINGS }, (_, i) => offset + (i * 360) / TURNAROUND_BEARINGS),
      OUT_AND_BACK_ROUTES
    );
    const candidates = await pool(
      [
        ...turnarounds.map((t) => () => buildOutAndBack(start, distance, t)),
        ...Array.from({ length: LOOP_BEARINGS }, (_, i) => () =>
          findLoop(start, distance, offset + 22.5 + (i * 360) / LOOP_BEARINGS, i % 2 === 0)
        ),
      ],
      CONCURRENCY
    );

    // Best-fitting first, then drop near-duplicates.
    const unique = [];
    for (const c of candidates.filter(Boolean).sort((a, b) => a.err - b.err)) {
      if (!unique.some((u) => overlap(c, u) > 0.75 && overlap(u, c) > 0.75)) unique.push(c);
    }
    unique.splice(10); // cap elevation lookups per search

    const routes = await Promise.all(
      unique.map(async (c, idx) => {
        let profile = [];
        let elevation = null;
        try {
          profile = smoothProfile(await getElevationProfile(c.path, c.distanceKm));
          elevation = elevationStats(profile);
        } catch (e) {
          console.warn(e.message);
        }
        return {
          id: `${Date.now().toString(36)}-${idx}`,
          distanceKm: Math.round(c.distanceKm * 100) / 100,
          bearing: Math.round(((c.bearing % 360) + 360) % 360),
          type: c.type,
          turnaround: c.turnaround ?? null,
          start,
          startAddress: c.startAddress,
          waypoints: c.waypoints,
          path: c.path,
          profile,
          elevation,
        };
      })
    );

    return Response.json({ routes });
  } catch (e) {
    console.error(e);
    return Response.json({ error: e.message }, { status: 502 });
  }
}
