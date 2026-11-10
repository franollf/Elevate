"use client";

import { useEffect, useMemo, useRef } from "react";

const W = 600;
const H = 140;

/**
 * Elevation profile area chart. Hovering reports the profile index so the map
 * can show where on the route you are.
 */
export default function ElevationChart({ profile, hoverIdx, onHover }) {
  const ref = useRef(null);

  // Pointer events fire far faster than the screen refreshes. Coalesce them to
  // one update per animation frame, and only when the hovered sample changes,
  // so fast mouse movement can't flood React with state updates.
  const frame = useRef(0);
  const pending = useRef(null);
  const lastSent = useRef(undefined);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const emit = (idx) => {
    pending.current = idx;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pending.current !== lastSent.current) {
        lastSent.current = pending.current;
        onHoverRef.current?.(pending.current);
      }
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    lastSent.current = undefined; // new route: allow re-sending the same index
  }, [profile]);

  const geom = useMemo(() => {
    if (!profile?.length) return null;
    const total = profile[profile.length - 1].d || 1;
    const els = profile.map((p) => p.elevation);
    let lo = Math.min(...els);
    let hi = Math.max(...els);
    // Keep at least 30 m of vertical range so flat routes look flat.
    if (hi - lo < 30) {
      const mid = (hi + lo) / 2;
      lo = mid - 15;
      hi = mid + 15;
    }
    const pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad;
    const x = (d) => (d / total) * W;
    const y = (e) => H - ((e - lo) / (hi - lo)) * H;
    const line = profile.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.elevation).toFixed(1)}`).join("");
    return { total, lo, hi, x, y, line, area: `${line}L${W},${H}L0,${H}Z` };
  }, [profile]);

  if (!geom) {
    return (
      <div className="h-36 grid place-items-center text-sm text-ink-3 bg-surface-2 rounded-xl">
        Elevation data unavailable
      </div>
    );
  }

  const handleMove = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const target = frac * geom.total;
    let best = 0;
    for (let i = 1; i < profile.length; i++) {
      if (Math.abs(profile[i].d - target) < Math.abs(profile[best].d - target)) best = i;
    }
    emit(best);
  };

  const hp = hoverIdx != null ? profile[hoverIdx] : null;

  return (
    <div className="select-none">
      <div
        ref={ref}
        className="relative h-36 cursor-crosshair"
        onPointerMove={handleMove}
        onPointerDown={handleMove}
        onPointerLeave={() => emit(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
          <defs>
            <linearGradient id="elev-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--line)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={geom.area} fill="url(#elev-fill)" />
          <path d={geom.line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>

        {/* y-axis labels */}
        <span className="absolute left-1 top-0 text-[10px] font-medium text-ink-3 tabular-nums">{Math.round(geom.hi)} m</span>
        <span className="absolute left-1 bottom-0 text-[10px] font-medium text-ink-3 tabular-nums">{Math.round(geom.lo)} m</span>

        {hp && (
          <>
            <div className="absolute top-0 bottom-0 w-px bg-ink/40 pointer-events-none" style={{ left: `${(hp.d / geom.total) * 100}%` }} />
            <div
              className="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full bg-white border-2 border-accent pointer-events-none"
              style={{ left: `${(hp.d / geom.total) * 100}%`, top: `${(geom.y(hp.elevation) / H) * 100}%` }}
            />
            <div
              className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded-md bg-ink text-white text-[11px] font-medium tabular-nums whitespace-nowrap pointer-events-none"
              style={{ left: `clamp(40px, ${(hp.d / geom.total) * 100}%, calc(100% - 40px))` }}
            >
              {hp.d.toFixed(2)} km · {Math.round(hp.elevation)} m
            </div>
          </>
        )}
      </div>
      <div className="flex justify-between mt-1 text-[10px] font-medium text-ink-3 tabular-nums">
        <span>0 km</span>
        <span>{(geom.total / 2).toFixed(1)} km</span>
        <span>{geom.total.toFixed(1)} km</span>
      </div>
    </div>
  );
}

/** Tiny profile used on route cards. */
export function Sparkline({ profile, active }) {
  const d = useMemo(() => {
    if (!profile?.length) return null;
    const total = profile[profile.length - 1].d || 1;
    const els = profile.map((p) => p.elevation);
    let lo = Math.min(...els);
    let hi = Math.max(...els);
    if (hi - lo < 30) {
      const mid = (hi + lo) / 2;
      lo = mid - 15;
      hi = mid + 15;
    }
    const line = profile
      .map((p, i) => `${i ? "L" : "M"}${((p.d / total) * 100).toFixed(1)},${(30 - ((p.elevation - lo) / (hi - lo)) * 28 - 1).toFixed(1)}`)
      .join("");
    return { line, area: `${line}L100,30L0,30Z` };
  }, [profile]);
  if (!d) return <div className="h-8" />;
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-8">
      <path d={d.area} fill={active ? "var(--accent)" : "var(--ink-3)"} fillOpacity={active ? 0.18 : 0.12} />
      <path d={d.line} fill="none" stroke={active ? "var(--accent)" : "var(--ink-3)"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
