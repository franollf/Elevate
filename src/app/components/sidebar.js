"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Sidebar({ allStats, selectedIdx, onSelectIdx }) {
  const [isOpen, setIsOpen] = useState(false);
  const stats = allStats[selectedIdx] || {};

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed top-4 z-50 bg-blue-500 text-white rounded-full p-2 shadow-md hover:bg-blue-600 transition-all ${
          isOpen ? "right-64" : "right-4"
        }`}
      >
        {isOpen ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
      </button>

      <div
        className={`fixed top-0 right-0 h-full w-64 bg-white shadow-lg z-40 transform transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="p-4 overflow-y-auto h-full">
          <h2 className="text-xl font-semibold mb-4 text-black">
            Route Details
          </h2>

          {allStats.length > 1 && (
            <select
              className="mb-4 w-full p-2 border rounded bg-white text-black"
              value={selectedIdx}
              onChange={(e) => onSelectIdx(Number(e.target.value))}
            >
              {allStats.map((_, i) => (
                <option key={i} value={i}>
                  Route {i + 1}
                </option>
              ))}
            </select>
          )}

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-blue-50 p-3 rounded text-blue-900">
              <p className="text-sm">Distance</p>
              <p className="text-lg font-bold text-black">
                {stats.distance ?? "--"} km
              </p>
            </div>
            <div className="bg-purple-50 p-3 rounded text-purple-900">
              <p className="text-sm">Est. Time</p>
              <p className="text-lg font-bold text-black">
                {stats.duration ?? "--"} min
              </p>
            </div>
            <div className="bg-orange-50 p-3 rounded text-orange-900">
              <p className="text-sm">Elevation Gain</p>
              <p className="text-lg font-bold text-black">
                {stats.elevation?.gain ?? "--"} m
              </p>
            </div>
            <div className="bg-orange-50 p-3 rounded text-orange-900">
              <p className="text-sm">Elevation Loss</p>
              <p className="text-lg font-bold text-black">
                {stats.elevation?.loss ?? "--"} m
              </p>
            </div>
            <div className="bg-green-50 p-3 rounded text-green-900">
              <p className="text-sm">Type</p>
              <p className="text-lg font-bold text-black">
                {stats.type ?? "--"}
              </p>
            </div>
          </div>

         

          <div className="mb-4">
            <p className="text-black font-medium mb-2">Route Points</p>
            <div className="text-sm space-y-1 text-black">
              <p>
                <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-2" />
                Start: {stats.start ?? "--"}
              </p>
              <p>
                <span className="inline-block w-2 h-2 bg-red-500 rounded-full mr-2" />
                End: {stats.end ?? "--"}
              </p>
            </div>
          </div>

          <div className="flex justify-between gap-2">
            <button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded">
              Start Run
            </button>
            <button className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 rounded">
              Export GPX
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
