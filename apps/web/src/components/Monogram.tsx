/** The RentMate "RM" monogram: champagne-gold serif letters on a black tile. */
export function Monogram({ size = 28 }: { size?: number }) {
  return (
    <span
      className="monogram"
      style={{ width: size, height: size, fontSize: size * 0.46 }}
      aria-hidden="true"
    >
      RM
    </span>
  );
}
