/**
 * Minimal 4×4 grid — four illuminated corner dots (Four Corners pattern).
 */
export default function FourCornersGridIcon({
  active = false,
  className = 'h-5 w-5',
}) {
  const dot = active ? '#3B82F6' : '#22C55E';
  const glow = active ? 'rgba(59,130,246,0.55)' : 'rgba(34,197,94,0.45)';
  const cell = 'rgba(255,255,255,0.06)';
  const line = 'rgba(255,255,255,0.08)';

  const corners = [
    [1, 1],
    [7, 1],
    [1, 7],
    [7, 7],
  ];

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      {/* Subtle 4×4 grid background */}
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2, 3].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={2 + col * 5}
            y={2 + row * 5}
            width="4"
            height="4"
            rx="0.5"
            fill={cell}
            stroke={line}
            strokeWidth="0.4"
          />
        ))
      )}

      {/* Illuminated corner dots */}
      {corners.map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r="2.8" fill={glow} />
          <circle cx={cx} cy={cy} r="1.6" fill={dot} />
        </g>
      ))}
    </svg>
  );
}
