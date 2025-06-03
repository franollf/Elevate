"use client";

import React, { useEffect, useState } from "react";
import { GoogleMap, LoadScript, Marker } from "@react-google-maps/api";
import WelcomePopup from "./components/popup";


const containerStyle = {
  width: "100%",
  height: "100%",
};

export default function Home() {
  const [userPosition, setUserPosition] = useState(null);
  const [userLocation, setUserLocation] = useState({
    lat: 49.2827, // Default to Vancouver
    lng: -123.1207,
  });

  // Automatically ask for location access when page loads
  useEffect(() => {
  navigator.geolocation.getCurrentPosition(
  (position) => {
    const { latitude, longitude } = position.coords;
    setUserLocation({ lat: latitude, lng: longitude });
    setUserPosition({ lat: latitude, lng: longitude });
  },
  (error) => {
    console.error("Geolocation error:", error);
  },
  {
    enableHighAccuracy: true, // ✅ Ask for GPS-level precision
    timeout: 5000,
    maximumAge: 0,
  }
);

}, []);


  return (
    <div className="relative h-screen w-screen flex">
      <WelcomePopup />

  
      <div className="flex-1">
        <LoadScript googleMapsApiKey="AIzaSyDotanGhUAEN_TtHURGm1awHrM3PdlESMM">
          <GoogleMap
            mapContainerStyle={containerStyle}
            center={userLocation}
            zoom={17}
          >
             {userPosition && (
          <Marker
  position={userPosition}
  icon={{
    url: "/images/totoro.png", // MUST be in /public/images
  }}
  onLoad={(marker) => {
    marker.setIcon({
      url: "/images/totoro.png",
      scaledSize: new window.google.maps.Size(25,35), // ✅ Now safe to use
    });
  }}
/>


        )}
          </GoogleMap>
        </LoadScript>
      </div>
    </div>
  );
}
