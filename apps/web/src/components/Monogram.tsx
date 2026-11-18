/** The RentMate "RM" monogram: serif letters on an ink tile (inverts with the theme). */
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
