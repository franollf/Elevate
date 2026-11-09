"use client";

import { useState } from "react";
import { Autocomplete } from "@react-google-maps/api";
import {
  ChevronDown,
  Download,
  ExternalLink,
  Loader2,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  Route as RouteIcon,
  Search,
  Shuffle,
} from "lucide-react";
import ElevationChart, { Sparkline } from "./ElevationChart";
import { formatDuration, formatPace, googleMapsUrl, toGpx } from "@/lib/geo";
const DISTANCES = [3, 5, 8, 10, 15];
const SORTS = [
  { id: "flat", label: "Flattest" },
  { id: "hilly", label: "Hilliest" },
  { id: "fit", label: "Closest" },
];

export const GRADES = [
  // hex (not CSS vars) because the map polylines use these too
  { max: 2, color: "#10b981", label: "< 2%" },
  { max: 5, color: "#eab308", label: "2–5%" },
  { max: 8, color: "#f97316", label: "5–8%" },
  { max: Infinity, color: "#dc2626", label: "> 8%" },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 rounded-xl bg-accent grid place-items-center shadow-sm">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 18l5.5-8 4 5 3-4L21 18" />
          <circle cx="17" cy="6" r="1.6" fill="white" stroke="none" />
        </svg>
      </div>
      <div className="leading-tight">
        <h1 className="text-[17px] font-semibold tracking-tight">Elevate</h1>
        <p className="text-xs text-ink-3">Flat running routes</p>
      </div>
    </div>
  );
}

function Label({ children, right }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{children}</span>
      {right}
    </div>
  );
}

function Stat({ label, value, unit }) {
  return (
    <div className="bg-surface-2 rounded-xl px-3 py-2.5">
      <div className="text-[11px] text-ink-3 font-medium">{label}</div>
      <div className="text-lg font-semibold tabular-nums tracking-tight">
        {value}
        {unit && <span className="text-xs font-medium text-ink-3 ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

function download(filename, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Panel({
  start,
  startLabel,
  locating,
  onLocate,
  onPlaceLoad,
  onPlaceChanged,
  distance,
  setDistance,
  pace,
  setPace,
  onFind,
  loading,
  error,
  routes,
  searched,
  sort,
  setSort,
  selectedId,
  setSelectedId,
  hoverIdx,
  setHoverIdx,
}) {
  const [sheetOpen, setSheetOpen] = useState(true);
  const flattestGain = routes.length ? Math.min(...routes.map((r) => r.elevation?.gain ?? Infinity)) : null;

  return (
    <aside
      className={`absolute z-20 bg-surface shadow-[0_8px_40px_rgb(0_0_0/0.14)] flex flex-col
        inset-x-0 bottom-0 rounded-t-3xl transition-[max-height] duration-300
        ${sheetOpen ? "max-h-[68dvh]" : "max-h-[92px]"}
        md:inset-x-auto md:left-4 md:top-4 md:bottom-4 md:w-[400px] md:rounded-3xl md:max-h-none`}
    >
      {/* mobile sheet handle */}
      <button
        onClick={() => setSheetOpen((o) => !o)}
        className="md:hidden pt-2 pb-1 grid place-items-center"
        aria-label={sheetOpen ? "Collapse panel" : "Expand panel"}
      >
        <span className="w-10 h-1.5 rounded-full bg-line" />
      </button>

      <div className="px-5 pt-2 md:pt-5 pb-4 border-b border-line flex items-center justify-between">
        <Logo />
        {routes.length > 0 && (
          <span className="text-xs font-medium text-ink-3 tabular-nums">
            {routes.length} route{routes.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin">
        {/* ---------- Controls ---------- */}
        <section className="px-5 py-4 space-y-5">
          <div>
            <Label>Start &amp; finish</Label>
            <div className="flex gap-2">
              <Autocomplete onLoad={onPlaceLoad} onPlaceChanged={onPlaceChanged} className="flex-1">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                  <input
                    type="text"
                    placeholder="Search an address or place"
                    className="w-full h-11 pl-9 pr-3 rounded-xl bg-surface-2 border border-transparent text-sm placeholder:text-ink-3 focus:outline-none focus:border-accent focus:bg-surface transition"
                  />
                </div>
              </Autocomplete>
              <button
                onClick={onLocate}
                title="Use my location"
                className="h-11 w-11 shrink-0 grid place-items-center rounded-xl bg-surface-2 text-ink-2 hover:text-accent hover:bg-accent-soft transition"
              >
                {locating ? <Loader2 size={18} className="animate-spin" /> : <LocateFixed size={18} />}
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-3 flex items-center gap-1.5 min-h-4">
              <MapPin size={12} className={start ? "text-accent" : ""} />
              <span className="truncate">{start ? startLabel : "Or tap anywhere on the map"}</span>
            </p>
          </div>

          <div>
            <Label right={<span className="text-sm font-semibold tabular-nums">{distance} km</span>}>Distance</Label>
            <div className="grid grid-cols-5 gap-1.5 mb-3">
              {DISTANCES.map((d) => (
                <button
                  key={d}
                  onClick={() => setDistance(d)}
                  className={`h-9 rounded-lg text-sm font-medium tabular-nums transition ${
                    distance === d ? "bg-ink text-white" : "bg-surface-2 text-ink-2 hover:bg-line"
                  }`}
                >
                  {d}K
                </button>
              ))}
            </div>
            <input
              type="range"
              min={1}
              max={25}
              step={0.5}
              value={distance}
              onChange={(e) => setDistance(Number(e.target.value))}
              className="w-full"
              aria-label="Distance in kilometres"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Pace</div>
              <div className="text-xs text-ink-3">Used for time estimates</div>
            </div>
            <div className="flex items-center gap-1 bg-surface-2 rounded-xl p-1">
              <button onClick={() => setPace(Math.max(3, pace - 0.25))} className="w-8 h-8 grid place-items-center rounded-lg hover:bg-surface text-ink-2" aria-label="Faster">
                <Minus size={14} />
              </button>
              <span className="w-16 text-center text-sm font-semibold tabular-nums">{formatPace(pace)}<span className="text-ink-3 font-medium">/km</span></span>
              <button onClick={() => setPace(Math.min(12, pace + 0.25))} className="w-8 h-8 grid place-items-center rounded-lg hover:bg-surface text-ink-2" aria-label="Slower">
                <Plus size={14} />
              </button>
            </div>
          </div>

          <button
            onClick={onFind}
            disabled={!start || loading}
            className="w-full h-12 rounded-xl bg-accent text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm hover:bg-accent-ink disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Finding flat routes…
              </>
            ) : searched ? (
              <>
                <Shuffle size={17} /> Find new routes
              </>
            ) : (
              <>
                <RouteIcon size={17} /> Find routes
              </>
            )}
          </button>
          {error && <p className="text-sm text-[var(--grade-hard)] bg-red-50 rounded-xl px-3 py-2">{error}</p>}
        </section>

        {/* ---------- Results ---------- */}
        {(loading || routes.length > 0 || searched) && (
          <section className="px-5 pb-6 border-t border-line pt-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Routes</span>
              <div className="flex bg-surface-2 rounded-lg p-0.5">
                {SORTS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSort(s.id)}
                    className={`px-2.5 h-7 rounded-md text-xs font-medium transition ${
                      sort === s.id ? "bg-surface shadow-sm text-ink" : "text-ink-3 hover:text-ink-2"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {loading && (
              <div className="space-y-2">
                <p className="text-xs text-ink-3">Comparing loops and out-and-backs for the flattest options — usually 5–15 seconds.</p>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-[92px] rounded-2xl bg-surface-2 animate-pulse" />
                ))}
              </div>
            )}

            {!loading && searched && routes.length === 0 && !error && (
              <div className="text-center py-8 text-sm text-ink-3">
                No routes found near this point. Try a different start or distance.
              </div>
            )}

            {!loading && (
              <ul className="space-y-2">
                {routes.map((r, i) => {
                  const active = r.id === selectedId;
                  const e = r.elevation;
                  return (
                    <li key={r.id}>
                      <div
                        className={`rounded-2xl border transition ${
                          active ? "border-accent bg-surface ring-4 ring-accent-soft" : "border-line hover:border-ink-3/40"
                        }`}
                      >
                        <button onClick={() => setSelectedId(active ? null : r.id)} className="w-full text-left px-4 pt-3 pb-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`w-6 h-6 rounded-full grid place-items-center text-[11px] font-semibold ${active ? "bg-accent text-white" : "bg-surface-2 text-ink-2"}`}>
                                {i + 1}
                              </span>
                              <span className="font-semibold tabular-nums">{r.distanceKm.toFixed(1)} km</span>
                              {e && e.gain === flattestGain && routes.length > 1 && (
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-ink bg-accent-soft px-1.5 py-0.5 rounded">
                                  Flattest
                                </span>
                              )}
                            </div>
                            <ChevronDown size={16} className={`text-ink-3 transition-transform ${active ? "rotate-180" : ""}`} />
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-ink-2 tabular-nums">
                            <span className="text-ink-3">{r.type === "out-and-back" ? "Out & back" : "Loop"}</span>
                            <span>↑ {e ? `${e.gain} m` : "–"}</span>
                            <span>{formatDuration(r.distanceKm * pace)}</span>
                            {e && <span>max {e.steepest}%</span>}
                          </div>
                          <div className="mt-1.5">
                            <Sparkline profile={r.profile} active={active} />
                          </div>
                        </button>

                        {active && (
                          <div className="px-4 pb-4 pt-1 space-y-4">
                            <div className="grid grid-cols-2 gap-2">
                              <Stat label="Distance" value={r.distanceKm.toFixed(2)} unit="km" />
                              <Stat label="Est. time" value={formatDuration(r.distanceKm * pace)} />
                              <Stat label="Elevation gain" value={e ? e.gain : "–"} unit="m" />
                              <Stat label="Steepest" value={e ? e.steepest : "–"} unit="%" />
                            </div>

                            <div className="pt-6">
                              <ElevationChart profile={r.profile} hoverIdx={hoverIdx} onHover={setHoverIdx} />
                            </div>

                            <div className="flex items-center gap-3 flex-wrap text-[11px] text-ink-3">
                              <span className="font-medium">Grade</span>
                              {GRADES.map((g) => (
                                <span key={g.label} className="flex items-center gap-1">
                                  <span className="w-3 h-1.5 rounded-full" style={{ background: g.color }} />
                                  {g.label}
                                </span>
                              ))}
                            </div>

                            {e && (
                              <p className="text-xs text-ink-3">
                                Lowest {e.min} m · highest {e.max} m · {e.loss} m descent
                              </p>
                            )}

                            <div className="space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  onClick={async () => {
                                    const { toFitCourse } = await import("@/lib/fit");
                                    download(
                                      `elevate-${r.distanceKm.toFixed(1)}km.fit`,
                                      toFitCourse(r, { name: `Elevate ${r.distanceKm.toFixed(1)}km`, paceMinPerKm: pace }),
                                      "application/vnd.ant.fit"
                                    );
                                  }}
                                  title="Garmin course file"
                                  className="h-10 rounded-xl bg-ink text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-ink/85 transition"
                                >
                                  <Download size={15} /> .FIT
                                </button>
                                <button
                                  onClick={() =>
                                    download(
                                      `elevate-${r.distanceKm.toFixed(1)}km.gpx`,
                                      toGpx(r, `Elevate ${r.distanceKm.toFixed(1)} km run`),
                                      "application/gpx+xml"
                                    )
                                  }
                                  className="h-10 rounded-xl bg-ink text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-ink/85 transition"
                                >
                                  <Download size={15} /> .GPX
                                </button>
                              </div>
                              <a
                                href={googleMapsUrl(r)}
                                target="_blank"
                                rel="noreferrer"
                                className="h-10 rounded-xl bg-surface-2 text-ink text-sm font-medium flex items-center justify-center gap-2 hover:bg-line transition"
                              >
                                <ExternalLink size={15} /> Open in Google Maps
                              </a>
                              <p className="text-[11px] text-ink-3 leading-snug">
                                Garmin: import the file at Garmin Connect → Training → Courses, then send it to your watch.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {!searched && !loading && (
          <section className="px-5 pb-6">
            <div className="rounded-2xl bg-surface-2 p-4 text-sm text-ink-2 space-y-2">
              <p className="font-medium text-ink">How it works</p>
              <ol className="list-decimal list-inside space-y-1 text-ink-2 text-[13px]">
                <li>Pick a start point — every route finishes where it starts.</li>
                <li>Choose a distance and hit <span className="font-medium">Find routes</span>.</li>
                <li>Compare elevation, then export a GPX for your watch.</li>
              </ol>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
