import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";

interface CometCascadeProps {
  count?: number;
  className?: string;
}

export function CometCascade({ count = 20, className }: CometCascadeProps) {
  const [comets, setComets] = useState<
    Array<{
      id: number;
      top: number;
      left: number;
      delay: number;
      duration: number;
    }>
  >([]);

  useEffect(() => {
    // Generate comets with random properties on the client to avoid hydration mismatch
    const generatedComets = Array.from({ length: count }).map((_, i) => ({
      id: i,
      top: Math.floor(Math.random() * 100), // Random starting top percentage
      left: Math.floor(Math.random() * 100) + 20, // Start slightly offscreen right
      delay: Math.random() * 5, // Random start delay
      duration: Math.random() * 3 + 2, // 2s to 5s duration
    }));
    setComets(generatedComets);
  }, [count]);

  return (
    <div
      className={clsx(
        "absolute inset-0 overflow-hidden pointer-events-none z-0",
        className
      )}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {comets.map((comet) => (
        <motion.div
          key={comet.id}
          className="absolute"
          style={{
            top: `${comet.top}%`,
            left: `${comet.left}%`,
            position: "absolute",
            width: "200px",
            height: "2px",
            transformOrigin: "right center",
          }}
          initial={{
            opacity: 0,
            x: 0,
            y: 0,
            rotate: 215, // Angle of the comet
            scale: 0,
          }}
          animate={{
            opacity: [0, 1, 0],
            x: -2000,
            y: 1500, // Distance to travel downwards
            scale: [0, 1, 0],
          }}
          transition={{
            duration: comet.duration,
            delay: comet.delay,
            repeat: Infinity,
            ease: "linear",
          }}
        >
          {/* Glowing head */}
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "50%",
              transform: "translateY(-50%)",
              width: "4px",
              height: "4px",
              borderRadius: "50%",
              backgroundColor: "#ffffff",
              boxShadow: "0 0 10px 2px #0066cc, 0 0 20px 4px rgba(0, 102, 204, 0.5)",
              zIndex: 1,
            }}
          />
          {/* Tapered tail */}
          <div
            style={{
              position: "absolute",
              right: "4px",
              top: "50%",
              transform: "translateY(-50%)",
              width: "100%",
              height: "2px",
              background: "linear-gradient(to right, transparent, rgba(0, 102, 204, 0.8))",
            }}
          />
        </motion.div>
      ))}
    </div>
  );
}
