import * as React from "react";

/** Fixed A4 paper coordinates shared by the staff and ink canvas. */
export const MUSIC_PAPER_WIDTH = 794;
export const MUSIC_PAPER_HEIGHT = 1123;

export function MusicStaff({ title }: { title?: string }) {
  return (
    <div className="music-staff" aria-label="Grand staff music paper">
      <div className="music-staff__title">{title || "Untitled music page"}</div>
      <svg viewBox="0 0 794 1123" width={MUSIC_PAPER_WIDTH} height={MUSIC_PAPER_HEIGHT} aria-hidden="true">
        {[0, 1, 2, 3, 4].map((system) => {
          const top = 140 + system * 194;
          const bass = top + 78;
          return (
            <g key={system}>
              {[0, 1, 2, 3, 4].map((line) => (
                <React.Fragment key={line}>
                  <line className="music-staff__line" x1="104" x2="724" y1={top + line * 12} y2={top + line * 12} />
                  <line className="music-staff__line" x1="104" x2="724" y1={bass + line * 12} y2={bass + line * 12} />
                </React.Fragment>
              ))}
              <path className="music-staff__brace" d={`M 96 ${top - 2} C 86 ${top + 12}, 86 ${bass + 31}, 96 ${bass + 50} M 99 ${top - 2} L 99 ${bass + 50}`} />
              <text className="music-staff__clef" x="108" y={top + 39} fontSize="54">𝄞</text>
              <text className="music-staff__clef" x="109" y={bass + 42} fontSize="43">𝄢</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
