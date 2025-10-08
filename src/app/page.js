// app/page.jsx
"use client";

import React, { useEffect, useState } from "react";
import {
  GoogleMap,
  Polyline,
  useJsApiLoader,
  Autocomplete,
} from "@react-google-maps/api";
import WelcomePopup from "./components/popup";
import Sidebar from "./components/sidebar";
import DistancePopup from "./components/DistancePopup";
import { getRoutesFor } from "./components/routeUtils";

const containerStyle = { width: "100%", height: "100%" };


const mapOptions = {
  disableDefaultUI: false, 
  mapTypeControl: false,   
  streetViewControl: false,
  fullscreenControl: false,
  styles: [
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    { featureType: "administrative", stylers: [{ visibility: "off" }] },
    { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  ],
};


export default function Home() {
  const [userPos, setUserPos] = useState(null); 
  const [routesStats, setRoutes] = useState([]);
  const [selectedIdx, setIdx] = useState(0);
  const [selectedDistance, setDistance] = useState(5); 
  const [autocomplete, setAutocomplete] = useState(null);


  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_ELEVATION_API_KEY,
    libraries: ["places"],
  });


  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setUserPos({ lat: coords.latitude, lng: coords.longitude }),
      console.error,
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  }, []);


  useEffect(() => {
    if (!userPos || !selectedDistance) return;

    setRoutes([]); // clear out old routes

    (async () => {
      const statsArray = await getRoutesFor(
        userPos.lat,
        userPos.lng,
        selectedDistance
      );
      setRoutes(statsArray);
      setIdx(0);
    })();
  }, [userPos, selectedDistance]);

  const currentPath = routesStats[selectedIdx]?.path ?? [];

 
  const onPlaceChanged = () => {
    if (autocomplete !== null) {
      const place = autocomplete.getPlace();
      if (place.geometry && place.geometry.location) {
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();
        setUserPos({ lat, lng });
      }
    } else {
      console.log("Autocomplete is not loaded yet!");
    }
  };

  if (!isLoaded) return <p>Loading Map...</p>;

  return (
    <div className="relative h-screen w-screen flex">
      {/* Distance picker */}
      <DistancePopup onSelectDistance={setDistance} />

      {/* Intro popup */}
      <WelcomePopup />

      {/* Stats sidebar */}
      <Sidebar
        allStats={routesStats}
        selectedIdx={selectedIdx}
        onSelectIdx={setIdx}
      />

      {/* Map canvas */}
      <div className="flex-1 relative">
        {/* 🔎 Search box overlay */}
        <div className="absolute top-4 left-1/2 z-10 -translate-x-1/2 w-96">
          <Autocomplete
            onLoad={(ac) => setAutocomplete(ac)}
            onPlaceChanged={onPlaceChanged}
          >
            <input
              type="text"
              placeholder="Search starting point..."
              className="w-full px-4 py-2 rounded-2xl shadow-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
            />
          </Autocomplete>
        </div>

        <GoogleMap
          mapContainerStyle={containerStyle}
          center={userPos ?? { lat: 49.2827, lng: -123.1207 }}
          zoom={14}
          options={mapOptions}
        >
          
          {/* 🚫 Removed Marker — only showing Polyline + roads */}
          <Polyline path={currentPath} options={{ strokeWeight: 4, strokeColor: "#1d4ed8" }} />
        </GoogleMap>
      </div>
    </div>
  );
}
