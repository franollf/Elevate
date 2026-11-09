// GET /api/loops?lat=..&lng=..&distance=5
// Builds several walking loops that start and finish at (lat, lng), each close
// to the target distance, and returns them with elevation stats + profile.
import polyline from "@mapbox/polyline";
import { destinationPoint, haversineKm } from "@/lib/geo";

export const maxDuration = 30;

const KEY =
  process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

const NUM_BEARINGS = 8; // candidate loop directions
const MAX_ITER = 3; // directions calls per candidate to tune its size
const GOOD_ENOUGH = 0.06; // stop tuning within 6% of target
const ACCEPT = 0.15; // discard loops more than 15% off target
const ROAD_FACTOR = 1.3; // walking paths are ~30% longer than the ideal circle

// ---------- Google API wrappers ----------

async function getDirections(start, waypoints) {
  const s = `${start.lat},${start.lng}`;
  const url =
    "https://maps.googleapis.com/maps/api/directions/json" +
    `?origin=${s}&destination=${s}` +
    `&waypoints=${encodeURIComponent(
      waypoints.map((w) => `${w.lat.toFixed(6)},${w.lng.toFixed(6)}`).join("|")
    )}` +
    `&mode=walking&key=${KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (data.status === "REQUEST_DENIED" || data.status === "OVER_QUERY_LIMIT") {
    throw new Error(`Directions API: ${data.status} ${data.error_message ?? ""}`);
  }
  if (data.status !== "OK" || !data.routes?.length) return null;
  const route = data.routes[0];
  // Stitch the detailed step polylines (overview_polyline is simplified).
  const path = [];
  for (const leg of route.legs) {
    for (const step of leg.steps) {
      for (const [lat, lng] of polyline.decode(step.polyline.points)) {
        const last = path[path.length - 1];
        if (!last || last.lat !== lat || last.lng !== lng) path.push({ lat, lng });
      }
    }
  }
  return {
    distanceKm: route.legs.reduce((s, l) => s + l.distance.value, 0) / 1000,
    startAddress: route.legs[0].start_address,
    path,
  };
}

async function getElevationProfile(path, distanceKm) {
  // ~1 sample every 20 m, capped by the API's 512 sample limit.
  const samples = Math.max(50, Math.min(512, Math.round((distanceKm * 1000) / 20)));
  // Keep the URL short: thin out the path until the encoded polyline fits.
  let pts = path;
  let enc = polyline.encode(pts.map((p) => [p.lat, p.lng]));
  while (enc.length > 7000 && pts.length > 2) {
    pts = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
    enc = polyline.encode(pts.map((p) => [p.lat, p.lng]));
  }
  const url =
    "https://maps.googleapis.com/maps/api/elevation/json" +
    `?path=enc:${encodeURIComponent(enc)}&samples=${samples}&key=${KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (data.status !== "OK") throw new Error(`Elevation API: ${data.status}`);

  let d = 0;
  return data.results.map((r, i, arr) => {
    const p = { lat: r.location.lat, lng: r.location.lng };
    if (i > 0) d += haversineKm(arr[i - 1].location, r.location);
    return { ...p, elevation: r.elevation, d };
  });
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
    const dir = await getDirections(start, waypoints);
    if (!dir) break;
    const err = Math.abs(dir.distanceKm - targetKm) / targetKm;
    if (!best || err < best.err) best = { ...dir, waypoints, err, bearing };
    if (err < GOOD_ENOUGH) break;
    radius *= Math.min(2, Math.max(0.5, targetKm / dir.distanceKm));
  }
  return best && best.err <= ACCEPT ? best : null;
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

function elevationStats(profile) {
  // Light 3-point smoothing so DEM noise doesn't inflate gain.
  const e = profile.map((p, i) => {
    const a = profile[Math.max(0, i - 1)].elevation;
    const b = profile[Math.min(profile.length - 1, i + 1)].elevation;
    return (a + p.elevation + b) / 3;
  });
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < e.length; i++) {
    const diff = e[i] - e[i - 1];
    if (diff > 0) gain += diff;
    else loss -= diff;
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
    const candidates = await Promise.all(
      Array.from({ length: NUM_BEARINGS }, (_, i) =>
        findLoop(start, distance, offset + (i * 360) / NUM_BEARINGS, i % 2 === 0)
      )
    );

    // Best-fitting first, then drop near-duplicates.
    const unique = [];
    for (const c of candidates.filter(Boolean).sort((a, b) => a.err - b.err)) {
      if (!unique.some((u) => overlap(c, u) > 0.75 && overlap(u, c) > 0.75)) unique.push(c);
    }

    const routes = await Promise.all(
      unique.map(async (c, idx) => {
        let profile = [];
        let elevation = null;
        try {
          profile = await getElevationProfile(c.path, c.distanceKm);
          elevation = elevationStats(profile);
        } catch (e) {
          console.warn(e.message);
        }
        return {
          id: `${Date.now().toString(36)}-${idx}`,
          distanceKm: Math.round(c.distanceKm * 100) / 100,
          bearing: Math.round(((c.bearing % 360) + 360) % 360),
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
