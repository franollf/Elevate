"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, MarkerF as Marker, PolylineF as Polyline, useJsApiLoader } from "@react-google-maps/api";
import Panel, { GRADES } from "./components/Panel";

const LIBRARIES = ["places"];
const DEFAULT_CENTER = { lat: 49.2827, lng: -123.1207 }; // Vancouver

const MAP_STYLES = [
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#d9ecd9" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#f1e6d0" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#cfe3ee" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#f4f5f2" }] },
  { featureType: "administrative", elementType: "labels.text.fill", stylers: [{ color: "#8a938e" }] },
];

const MAP_OPTIONS = {
  styles: MAP_STYLES,
  disableDefaultUI: true,
  zoomControl: true,
  clickableIcons: false,
  gestureHandling: "greedy",
};

/** Split a profile into consecutive runs of the same grade colour. */
function gradeSegments(profile) {
  if (!profile?.length) return [];
  const colorAt = (i) => {
    // grade over a ~60 m window centred on i
    let a = i;
    let b = i;
    while (a > 0 && profile[i].d - profile[a].d < 0.03) a--;
    while (b < profile.length - 1 && profile[b].d - profile[i].d < 0.03) b++;
    const run = (profile[b].d - profile[a].d) * 1000;
    const g = run > 0 ? (Math.abs(profile[b].elevation - profile[a].elevation) / run) * 100 : 0;
    return GRADES.find((x) => g < x.max).color;
  };
  const segs = [];
  let cur = null;
  for (let i = 0; i < profile.length; i++) {
    const c = colorAt(i);
    const pt = { lat: profile[i].lat, lng: profile[i].lng };
    if (!cur || cur.color !== c) {
      cur = { color: c, style: gradeStyle(c), path: cur ? [cur.path[cur.path.length - 1], pt] : [pt] };
      segs.push(cur);
    } else cur.path.push(pt);
  }
  return segs;
}

// Static overlay styles: stable objects so map overlays aren't reconfigured on every render.
const CASING = { strokeColor: "#ffffff", strokeOpacity: 1, strokeWeight: 10, zIndex: 2 };
const PLAIN_SELECTED = { strokeColor: "#0f9d6b", strokeWeight: 5, zIndex: 3 };
const OTHER_DIM = { strokeColor: "#15201b", strokeOpacity: 0.18, strokeWeight: 3, zIndex: 1 };
const OTHER = { strokeColor: "#15201b", strokeOpacity: 0.45, strokeWeight: 3, zIndex: 1 };
const gradeStyle = (color) => ({ strokeColor: color, strokeOpacity: 1, strokeWeight: 5, zIndex: 3 });
const circleIcon = (scale, fillColor, strokeColor) => () => ({
  path: window.google.maps.SymbolPath.CIRCLE,
  scale,
  fillColor,
  fillOpacity: 1,
  strokeColor,
  strokeWeight: 3,
});
const startIcon = circleIcon(9, "#15201b", "#ffffff");
const turnIcon = circleIcon(6, "#ffffff", "#15201b");
const hoverIcon = circleIcon(7, "#ffffff", "#0f9d6b");

/**
 * Routes and markers. Memoised so hovering the elevation chart (which updates
 * many times a second) only moves the hover dot instead of re-rendering every
 * polyline on the map.
 */
const RouteLayers = memo(function RouteLayers({ routes, selected, segments, start, onSelect, icons }) {
  return (
    <>
      {routes
        .filter((r) => r.id !== selected?.id)
        .map((r) => (
          <Polyline key={r.id} path={r.path} onClick={() => onSelect(r.id)} options={selected ? OTHER_DIM : OTHER} />
        ))}

      {selected && (
        <>
          <Polyline path={selected.path} options={CASING} />
          {segments.length ? (
            segments.map((s, i) => <Polyline key={`${selected.id}-${i}`} path={s.path} options={s.style} />)
          ) : (
            <Polyline path={selected.path} options={PLAIN_SELECTED} />
          )}
        </>
      )}

      {start && <Marker position={start} zIndex={10} title="Start / finish" icon={icons.start} />}
      {selected?.turnaround && <Marker position={selected.turnaround} zIndex={9} title="Turnaround" icon={icons.turn} />}
    </>
  );
});

function loadPace() {
  try {
    const v = Number(localStorage.getItem("elevate:pace"));
    return v >= 3 && v <= 12 ? v : 6;
  } catch {
    return 6;
  }
}

export default function Home() {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey:
      process.env.NEXT_PUBLIC_ELEVATION_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  const mapRef = useRef(null);
  const autocompleteRef = useRef(null);

  const [start, setStart] = useState(null);
  const startRef = useRef(null);
  startRef.current = start;
  const [startLabel, setStartLabel] = useState("");
  const [locating, setLocating] = useState(false);
  const [distance, setDistance] = useState(5);
  const [pace, setPaceState] = useState(6);
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [sort, setSort] = useState("flat");
  const [selectedId, setSelectedId] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);

  useEffect(() => setPaceState(loadPace()), []);
  const setPace = (v) => {
    setPaceState(v);
    try {
      localStorage.setItem("elevate:pace", String(v));
    } catch {}
  };

  const changeStart = useCallback((pos, label) => {
    setStart(pos);
    setStartLabel(label);
    setRoutes([]);
    setSelectedId(null);
    setSearched(false);
    setError("");
    mapRef.current?.panTo(pos);
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return setError("Geolocation isn't available in this browser.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        changeStart({ lat: coords.latitude, lng: coords.longitude }, "Your location");
        mapRef.current?.setZoom(15);
      },
      () => {
        setLocating(false);
        if (!startRef.current) setError("Couldn't get your location — search or tap the map instead.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }, [changeStart]);

  // Try the user's location once on load.
  useEffect(() => {
    if (isLoaded) locate();
  }, [isLoaded, locate]);

  const onPlaceChanged = () => {
    const place = autocompleteRef.current?.getPlace();
    const loc = place?.geometry?.location;
    if (!loc) return;
    changeStart({ lat: loc.lat(), lng: loc.lng() }, place.formatted_address || place.name);
    mapRef.current?.setZoom(15);
  };

  const findLoops = async () => {
    if (!start) return;
    setLoading(true);
    setError("");
    setSelectedId(null);
    setHoverIdx(null);
    try {
      const res = await fetch(`/api/loops?lat=${start.lat}&lng=${start.lng}&distance=${distance}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setRoutes(data.routes);
      if (data.routes[0]?.startAddress && startLabel !== "Your location") setStartLabel(data.routes[0].startAddress);
    } catch (e) {
      setRoutes([]);
      setError(e.message);
    } finally {
      setSearched(true);
      setLoading(false);
    }
  };

  const sorted = useMemo(() => {
    const gain = (r) => r.elevation?.gain ?? Infinity;
    const list = [...routes];
    if (sort === "flat") list.sort((a, b) => gain(a) - gain(b));
    if (sort === "hilly") list.sort((a, b) => gain(b) - gain(a));
    if (sort === "fit") list.sort((a, b) => Math.abs(a.distanceKm - distance) - Math.abs(b.distanceKm - distance));
    return list;
  }, [routes, sort, distance]);

  // Select the top route whenever a new result set arrives.
  useEffect(() => {
    if (routes.length) setSelectedId((id) => id ?? sorted[0].id);
  }, [routes]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(() => routes.find((r) => r.id === selectedId) ?? null, [routes, selectedId]);
  const segments = useMemo(() => gradeSegments(selected?.profile), [selected]);
  const icons = useMemo(
    () => (isLoaded ? { start: startIcon(), turn: turnIcon(), hover: hoverIcon() } : null),
    [isLoaded]
  );
  const selectRoute = useCallback((id) => {
    setHoverIdx(null);
    setSelectedId(id);
  }, []);

  // Frame the selected loop with room for the panel.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected) return;
    const b = new window.google.maps.LatLngBounds();
    selected.path.forEach((p) => b.extend(p));
    const desktop = window.innerWidth >= 768;
    const id = requestAnimationFrame(() =>
      map.fitBounds(
        b,
        desktop
          ? { top: 64, bottom: 64, left: 448, right: 64 }
          : { top: 32, bottom: Math.round(window.innerHeight * 0.68) + 16, left: 24, right: 24 }
      )
    );
    return () => cancelAnimationFrame(id);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) {
    return <div className="h-dvh grid place-items-center text-ink-2">Couldn&apos;t load Google Maps. Check the API key.</div>;
  }

  const hoverPt = selected && hoverIdx != null ? selected.profile[hoverIdx] : null;

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      {isLoaded ? (
        <GoogleMap
          mapContainerClassName="absolute inset-0"
          center={DEFAULT_CENTER}
          zoom={13}
          options={MAP_OPTIONS}
          onLoad={(m) => (mapRef.current = m)}
          onUnmount={() => (mapRef.current = null)}
          onClick={(e) => changeStart({ lat: e.latLng.lat(), lng: e.latLng.lng() }, "Dropped pin")}
        >
          <RouteLayers
            routes={routes}
            selected={selected}
            segments={segments}
            start={start}
            onSelect={selectRoute}
            icons={icons}
          />

          {/* Always mounted (just hidden) so hovering only moves it. */}
          {selected && (
            <Marker
              position={hoverPt ?? selected.path[0]}
              visible={!!hoverPt}
              zIndex={11}
              clickable={false}
              icon={icons.hover}
            />
          )}
        </GoogleMap>
      ) : (
        <div className="absolute inset-0 bg-surface-2 animate-pulse" />
      )}

      {isLoaded && (
        <Panel
          start={start}
          startLabel={startLabel}
          locating={locating}
          onLocate={locate}
          onPlaceLoad={(ac) => (autocompleteRef.current = ac)}
          onPlaceChanged={onPlaceChanged}
          distance={distance}
          setDistance={setDistance}
          pace={pace}
          setPace={setPace}
          onFind={findLoops}
          loading={loading}
          error={error}
          routes={sorted}
          searched={searched}
          sort={sort}
          setSort={setSort}
          selectedId={selectedId}
          setSelectedId={selectRoute}
          hoverIdx={hoverIdx}
          setHoverIdx={setHoverIdx}
        />
      )}
    </main>
  );
}
