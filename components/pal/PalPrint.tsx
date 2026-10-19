import { PAL_PRINT_SIZE } from "@/lib/palGenome";

// The Pal print: a five-by-five mark, mirrored like a face, grown from the
// Pal's genome. It is the one thing about a Pal that no other Pal shares, so
// it sits beside the name. It is a mark, not a level or a score.
export default function PalPrint({ print }: { print: readonly boolean[] }) {
  return (
    <svg className="palPrint" viewBox={`0 0 ${PAL_PRINT_SIZE} ${PAL_PRINT_SIZE}`} aria-hidden="true" focusable="false">
      {print.map((on, index) =>
        on ? (
          <rect
            key={index}
            x={(index % PAL_PRINT_SIZE) + 0.08}
            y={Math.floor(index / PAL_PRINT_SIZE) + 0.08}
            width={0.84}
            height={0.84}
            rx={0.2}
          />
        ) : null,
      )}
    </svg>
  );
}
