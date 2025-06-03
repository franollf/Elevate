"use client";
import { useState } from "react";

export default function WelcomePopup() {
  const [show, setShow] = useState(true);

  if (!show) return null;

  return (
    <>
      {/* Dim + blur background */}
      <div className="absolute inset-0 bg-white/30 backdrop-blur-sm z-40" />

      {/* Centered popup */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50">
        <div className="bg-white rounded-2xl shadow-xl p-6 w-[350px] border border-gray-200">
          <div className="text-blue-600 text-xl font-semibold mb-2 flex items-center gap-2">
            <span className="text-xl">ℹ️</span> Welcome to RunRoute Finder
          </div>
          <p className="text-gray-700 mb-4 text-sm">
            This app helps you find running routes with minimal elevation gain around your current location.
          </p>
          <ul className="list-disc list-inside text-gray-600 text-sm mb-4 space-y-1">
            <li>Select your desired distance (3km, 5km, or 10km)</li>
            <li>We’ll generate multiple low-elevation route options</li>
            <li>Compare routes and save your favorites</li>
          </ul>
          <button
            onClick={() => setShow(false)}
            className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 transition"
          >
            Get Started
          </button>
        </div>
      </div>
    </>
  );
}
