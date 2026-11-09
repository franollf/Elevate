// Encode a loop as a Garmin FIT *course* file (what watches use for
// "Navigation → Courses"). Follows Garmin's course-file cookbook:
// FileId → Course → Lap → Event(start) → Records… → Event(stop).
import { Encoder, Profile } from "@garmin/fitsdk";
import { haversineKm } from "./geo";

const SEMICIRCLES = 2 ** 31 / 180;
const toSemi = (deg) => Math.round(deg * SEMICIRCLES);

/**
 * @param route  route object from /api/loops
 * @param opts   { name, paceMinPerKm }
 * @returns Uint8Array containing the .fit file
 */
export function toFitCourse(route, { name = "Elevate loop", paceMinPerKm = 6 } = {}) {
  // Points with cumulative distance (m) and altitude when available.
  let pts;
  if (route.profile?.length) {
    // Sample-to-sample distance cuts corners slightly; scale to the real route length.
    const k = (route.distanceKm * 1000) / (route.profile[route.profile.length - 1].d * 1000 || 1);
    pts = route.profile.map((p) => ({ lat: p.lat, lng: p.lng, alt: p.elevation, dist: p.d * 1000 * k }));
  } else {
    let d = 0;
    pts = route.path.map((p, i, arr) => {
      if (i) d += haversineKm(arr[i - 1], p) * 1000;
      return { lat: p.lat, lng: p.lng, alt: null, dist: d };
    });
  }

  const secPerMeter = (paceMinPerKm * 60) / 1000;
  const startTime = new Date();
  const timeAt = (distM) => new Date(startTime.getTime() + Math.round(distM * secPerMeter) * 1000);
  const totalDist = pts[pts.length - 1].dist;
  const totalTime = Math.round(totalDist * secPerMeter);
  const endTime = timeAt(totalDist);
  const first = pts[0];
  const last = pts[pts.length - 1];

  const enc = new Encoder();
  const M = Profile.MesgNum;

  enc.onMesg(M.FILE_ID, {
    type: "course",
    manufacturer: "development",
    product: 1,
    serialNumber: Math.floor(Math.random() * 0xffffffff),
    timeCreated: startTime,
  });

  enc.onMesg(M.COURSE, { name: name.slice(0, 15), sport: "running" });

  enc.onMesg(M.LAP, {
    messageIndex: 0,
    timestamp: endTime,
    startTime,
    startPositionLat: toSemi(first.lat),
    startPositionLong: toSemi(first.lng),
    endPositionLat: toSemi(last.lat),
    endPositionLong: toSemi(last.lng),
    totalElapsedTime: totalTime,
    totalTimerTime: totalTime,
    totalDistance: totalDist,
    ...(route.elevation && { totalAscent: route.elevation.gain, totalDescent: route.elevation.loss }),
  });

  enc.onMesg(M.EVENT, { timestamp: startTime, event: "timer", eventType: "start", eventGroup: 0 });

  for (const p of pts) {
    enc.onMesg(M.RECORD, {
      timestamp: timeAt(p.dist),
      positionLat: toSemi(p.lat),
      positionLong: toSemi(p.lng),
      distance: p.dist,
      ...(p.alt != null && { altitude: p.alt }),
    });
  }

  enc.onMesg(M.EVENT, { timestamp: endTime, event: "timer", eventType: "stopDisableAll", eventGroup: 0 });

  return enc.close();
}
