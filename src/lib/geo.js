// Pure geo helpers shared by the server route finder and the client UI.

const R_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Point a given distance (km) and bearing (deg) from an origin. */
export function destinationPoint({ lat, lng }, distanceKm, bearingDeg) {
  const φ1 = toRad(lat);
  const λ1 = toRad(lng);
  const θ = toRad(bearingDeg);
  const δ = distanceKm / R_KM;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 };
}

/** Great-circle distance in km. */
export function haversineKm(a, b) {
  const dφ = toRad(b.lat - a.lat);
  const dλ = toRad(b.lng - a.lng);
  const h =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dλ / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

/** "6.5" min/km -> "6:30" */
export function formatPace(minPerKm) {
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** minutes -> "42 min" / "1 h 05 min" */
export function formatDuration(totalMin) {
  const mins = Math.round(totalMin);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")} min`;
}

/** Build a GPX 1.1 track for a route. */
export function toGpx(route, name = "Elevate loop") {
  const esc = (s) =>
    String(s).replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const pts = route.profile.length
    ? route.profile
    : route.path.map((p) => ({ ...p, elevation: null }));
  const trkpts = pts
    .map(
      (p) =>
        `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">` +
        (p.elevation != null ? `<ele>${p.elevation.toFixed(1)}</ele>` : "") +
        `</trkpt>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Elevate" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
  <trk>
    <name>${esc(name)}</name>
    <type>running</type>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

/**
 * Google Maps walking-directions link that approximates the route. Google
 * would pick its own path between sparse waypoints, so pin it to 8 points
 * sampled along our actual path (Google's URL limit is ~9 waypoints).
 */
export function googleMapsUrl(route) {
  const s = `${route.start.lat},${route.start.lng}`;
  const n = 8;
  const pts = Array.from({ length: n }, (_, i) =>
    route.path[Math.round(((i + 1) * (route.path.length - 1)) / (n + 1))]
  );
  const wps = pts.map((w) => `${w.lat.toFixed(6)},${w.lng.toFixed(6)}`).join("|");
  return (
    `https://www.google.com/maps/dir/?api=1&travelmode=walking` +
    `&origin=${encodeURIComponent(s)}&destination=${encodeURIComponent(s)}` +
    `&waypoints=${encodeURIComponent(wps)}`
  );
}
