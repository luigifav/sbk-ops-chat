/**
 * SbkLogo — the official SBK logotype reproduced as an inline SVG.
 *
 * Design: "SBK" lettering in light weight flanked by two corner brackets:
 *   ⌐ top-left  (horizontal arm pointing right, vertical arm pointing down)
 *   ⌟ bottom-right  (horizontal arm pointing left, vertical arm pointing up)
 *
 * Usage:
 *   <SbkLogo />                          white, 120 × 40
 *   <SbkLogo color="#1F3A3A" width={160} height={53} />   dark on light bg
 */
interface SbkLogoProps {
  color?: string
  width?: number
  height?: number
}

export default function SbkLogo({
  color = '#FFFFFF',
  width = 120,
  height = 40,
}: SbkLogoProps) {
  // All geometry is defined in a 200 × 68 coordinate space and scaled via width/height.
  // "SBK" text: x=100 (center), y=49, fontSize=44, fontWeight=300
  // Top-left bracket corner at (40, 10) — right arm to (62,10) — down arm to (40,26)
  // Bottom-right bracket corner at (160, 58) — left arm to (138,58) — up arm to (160,42)
  const sw = (2.4 * 200) / width  // keep stroke visually consistent across sizes
  const r = 4                      // corner radius for the bracket bends

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 200 68"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="SBK"
    >
      {/* ── Top-left bracket ⌐ ── */}
      {/* Start from the end of the horizontal arm, run left to corner, bend down */}
      <path
        d={`M 62,10 L ${40 + r},10 Q 40,10 40,${10 + r} L 40,26`}
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        fill="none"
      />

      {/* ── SBK lettering ── */}
      <text
        x="101"
        y="50"
        fontFamily="'Plus Jakarta Sans', system-ui, sans-serif"
        fontSize="44"
        fontWeight="300"
        fill={color}
        textAnchor="middle"
        letterSpacing="0.5"
      >
        SBK
      </text>

      {/* ── Bottom-right bracket ⌟ ── */}
      {/* Start from end of horizontal arm, run right to corner, bend up */}
      <path
        d={`M 138,58 L ${160 - r},58 Q 160,58 160,${58 - r} L 160,42`}
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
