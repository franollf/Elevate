"use client";
import { useState, useRef, useEffect } from "react";
import polyline from "@mapbox/polyline";

// Compute a lat/lng a given distance (km) and bearing (deg) from an origin
function computeDestination(lat, lng, distanceKm, bearingDeg) {
  const R = 6371; // Earth radius in km
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;

  const φ1 = toRad(lat);
  const λ1 = toRad(lng);
  const θ = toRad(bearingDeg);
  const δ = distanceKm / R;

  const φ2 =
    Math.asin(
      Math.sin(φ1) * Math.cos(δ) +
        Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
    );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );

  return { lat: toDeg(φ2), lng: toDeg(λ2) };
}

/**
 * Fetch routes for each bearing and pick the one closest to the target distance
 */
export async function getRoutesFor(
  startLat,
  startLng,
  targetDistanceKm,
  numBearings = 8,
  maxRoutes = 5,
  tolerance = 0.2, // 20% tolerance
  binaryIterations = 4,
  maxElevationGain = 50 // Max elevation gain in meters
) {
  const origin = `${startLat},${startLng}`;
  if (!window.google || !window.google.maps) {
    console.error("Google Maps JavaScript API not loaded");
    return [];
  }
  const elevationService = new window.google.maps.ElevationService();

  const bearings = Array.from({ length: numBearings }, () => Math.random() * 360);

  const candidatesArrays = await Promise.all(
    bearings.map(async (bearing) => {
      try {
        let low = targetDistanceKm * 0.5;
        let high = targetDistanceKm * 1.5;
        let optimalDistance = targetDistanceKm;
        for (let iter = 0; iter < binaryIterations; iter++) {
          const mid = (low + high) / 2;
          const { lat: dLat, lng: dLng } = computeDestination(
            startLat,
            startLng,
            mid,
            bearing
          );
          const res = await fetch(
            `/api/directions?origin=${encodeURIComponent(origin)}` +
              `&destination=${encodeURIComponent(`${dLat},${dLng}`)}` +
              `&mode=walking`
          );
          const data = await res.json();
          if (!Array.isArray(data.routes) || data.routes.length === 0) break;

          const distKm = data.routes[0].legs[0].distance.value / 1000;
          if (distKm > targetDistanceKm) high = mid;
          else low = mid;
          optimalDistance = mid;
        }

        const { lat: dLat, lng: dLng } = computeDestination(
          startLat,
          startLng,
          optimalDistance,
          bearing
        );
        const res = await fetch(
          `/api/directions?origin=${encodeURIComponent(origin)}` +
            `&destination=${encodeURIComponent(`${dLat},${dLng}`)}` +
            `&mode=walking&alternatives=true`
        );
        const data = await res.json();
        if (!Array.isArray(data.routes) || data.routes.length === 0) return [];

        return await Promise.all(
          data.routes.map(async (route) => {
            const leg = route.legs[0];
            const distKm = leg.distance.value / 1000;
            if (Math.abs(distKm - targetDistanceKm) / targetDistanceKm > tolerance)
              return null;

            const paceMinPerKm = 6.5;
            const duration = Math.round(distKm * paceMinPerKm);
            const encoded = route.overview_polyline.points;
            const path = polyline.decode(encoded).map(([lat, lng]) => ({ lat, lng }));

            let elevation = { gain: 0, loss: 0, start: null, end: null, profile: [] };
            try {
              const elevationResponse = await new Promise((resolve, reject) => {
                elevationService.getElevationAlongPath(
                  { path, samples: 100 },
                  (results, status) => {
                    if (status === "OK" && results) resolve(results);
                    else reject(new Error(`ElevationService failed: ${status}`));
                  }
                );
              });

              let gain = 0;
              let loss = 0;
              for (let i = 1; i < elevationResponse.length; i++) {
                const diff =
                  elevationResponse[i].elevation -
                  elevationResponse[i - 1].elevation;
                if (diff > 0) gain += diff;
                else loss += Math.abs(diff);
              }
              elevation = {
                gain: Math.round(gain),
                loss: Math.round(loss),
                start: elevationResponse[0]?.elevation ?? null,
                end:
                  elevationResponse[elevationResponse.length - 1]?.elevation ??
                  null,
                profile: elevationResponse.map((p, i) => ({
                  lat: path[i]?.lat || p.location.lat(),
                  lng: path[i]?.lng || p.location.lng(),
                  elevation: p.elevation,
                })),
              };
            } catch (error) {
              console.warn(`ElevationService failed for bearing ${bearing}:`, error.message);
            }

            return {
              distKm,
              stats: {
                distance: +distKm.toFixed(2),
                duration,
                elevation,
                type: "Running",
                start: leg.start_address,
                end: leg.end_address,
              },
              path,
            };
          })
        ).then((routes) => routes.filter((r) => r !== null));
      } catch (error) {
        console.error(`Error fetching route for bearing ${bearing}:`, error);
        return [];
      }
    })
  );

  let candidates = candidatesArrays.flat();
  const lowElevationCandidates = candidates.filter(
    (c) => c.stats.elevation.gain <= maxElevationGain
  );
  candidates = lowElevationCandidates.length > 0 ? lowElevationCandidates : candidates;

  candidates.sort((a, b) => {
    if (a.stats.elevation.gain !== b.stats.elevation.gain)
      return a.stats.elevation.gain - b.stats.elevation.gain;
    return (
      Math.abs(a.distKm - targetDistanceKm) -
      Math.abs(b.distKm - targetDistanceKm)
    );
  });

  candidates = candidates.slice(0, maxRoutes);

  return candidates.map((c) => ({
    ...c.stats,
    path: c.path,
  }));
}

/**
 * Component: Lets user pick a start point with Google Places Autocomplete
 */
export function StartPointChooser({ onSelect }) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);

  useEffect(() => {
    if (window.google && window.google.maps && !autocompleteRef.current) {
      autocompleteRef.current = new window.google.maps.places.Autocomplete(
        inputRef.current,
        { types: ["geocode"] }
      );
      autocompleteRef.current.addListener("place_changed", () => {
        const place = autocompleteRef.current.getPlace();
        if (place.geometry) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          onSelect({ lat, lng, address: place.formatted_address });
        }
      });
    }
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      placeholder="Enter starting address or place"
      className="border p-2 rounded w-full"
    />
  );
}
