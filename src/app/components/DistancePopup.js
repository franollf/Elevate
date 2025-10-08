"use client";

import React, { useState } from "react";
import { Settings, X } from "lucide-react";

export default function DistancePopup({ onSelectDistance }) {
  const [isOpen, setIsOpen] = useState(false);
  const options = [
    { label: "3K", value: 3, color: "blue" },
    { label: "5K", value: 5, color: "orange" },
    { label: "10K", value: 10, color: "purple" },
  ];

  return (
    <>
      <div className="relative">
        {/* Trigger Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="fixed top-4 left-4 z-50 bg-green-500 text-white rounded-full p-2 shadow-md hover:bg-green-600 transition-all"
        >
          <Settings size={20} />
        </button>

        {/* Small Popup */}
        {isOpen && (
          <div className="absolute top-16 left-4 z-40 w-48 bg-white rounded-lg shadow-lg p-4">
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
            >
              <X size={16} />
            </button>

            <h2 className="text-md font-semibold mb-3 text-black">
              Select Distance
            </h2>

            <div className="grid grid-cols-1 gap-2">
              {options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    onSelectDistance(opt.value);
                    setIsOpen(false);
                  }}
                  className={`w-full py-2 rounded bg-${opt.color}-50 text-${opt.color}-900 font-medium hover:opacity-80 transition-all`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
