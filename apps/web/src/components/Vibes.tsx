import { useRef, useState } from "react";
import type { Vibe } from "../vibes";
import { Icon } from "./Icon";

/** Original, simple illustrations for each vibe (no third-party artwork). */
function VibeArt({ art }: { art: Vibe["art"] }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const shapes: Record<Vibe["art"], JSX.Element> = {
    spark: (
      <path
        {...common}
        d="M60 14v26M60 80v26M14 60h26M80 60h26M30 30l14 14M76 76l14 14M90 30L76 44M44 76L30 90"
      />
    ),
    heart: (
      <path
        {...common}
        d="M60 98S20 74 14 52C9 34 22 20 38 20c10 0 17 6 22 13 5-7 12-13 22-13 16 0 29 14 24 32-6 22-46 46-46 46z"
      />
    ),
    brush: <path {...common} d="M24 96c10 0 18-6 18-16 0-6 6-10 12-8L96 24M54 72L44 62M84 22l14 14" />,
    film: <path {...common} d="M18 30h84v60H18zM18 46h84M18 74h84M36 30v60M84 30v60" />,
    ball: (
      <path
        {...common}
        d="M60 100a40 40 0 1 0 0-80 40 40 0 0 0 0 80zM24 46c22 6 50 6 72 0M24 74c22-6 50-6 72 0M60 20c-14 26-14 54 0 80"
      />
    ),
    compass: <path {...common} d="M60 102a42 42 0 1 0 0-84 42 42 0 0 0 0 84zM74 46L66 66 46 74l8-20z" />,
    bowl: (
      <path
        {...common}
        d="M16 58h88c0 22-20 38-44 38S16 80 16 58zM40 44c0-8 8-8 8-16M60 44c0-8 8-8 8-16M80 44c0-8 8-8 8-16"
      />
    ),
    note: (
      <path
        {...common}
        d="M44 86V30l50-10v54M44 86a12 12 0 1 1-24 0 12 12 0 0 1 24 0zM94 74a12 12 0 1 1-24 0 12 12 0 0 1 24 0z"
      />
    ),
    road: <path {...common} d="M40 104L54 16M80 104L66 16M60 96v-10M60 72V60M60 46V36M60 24v-6" />,
    pin: (
      <path
        {...common}
        d="M60 104s-32-28-32-56a32 32 0 0 1 64 0c0 28-32 56-32 56zM60 60a12 12 0 1 0 0-24 12 12 0 0 0 0 24z"
      />
    ),
  };
  return (
    <svg viewBox="0 0 120 120" className="vibe-art" aria-hidden="true">
      {shapes[art]}
    </svg>
  );
}

/** Swipeable carousel of Vibes with indicators and buttons. */
export function Vibes({ vibes, onOpen }: { vibes: Vibe[]; onOpen: (v: Vibe) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const go = (i: number) => {
    const el = track.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    setAt(i);
  };

  return (
    <section className="vibes" aria-roledescription="carousel" aria-label="Vibes">
      <div className="vibes-head">
        <h3 className="display-sm">Vibes</h3>
        <div className="row">
          <button
            className="icon-btn"
            aria-label="Previous vibe"
            disabled={at === 0}
            onClick={() => go(at - 1)}
          >
            <Icon name="back" size={18} />
          </button>
          <button
            className="icon-btn"
            aria-label="Next vibe"
            disabled={at >= vibes.length - 1}
            onClick={() => go(at + 1)}
          >
            <Icon name="chevron" size={18} />
          </button>
        </div>
      </div>
      <div
        className="vibes-track"
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 1;
          setAt(Math.round(el.scrollLeft / (w + 12)));
        }}
      >
        {vibes.map((v, i) => (
          <article
            key={v.key}
            className={`vibe-card ${v.tone}`}
            aria-roledescription="slide"
            aria-label={`${v.title}, ${i + 1} of ${vibes.length}`}
          >
            <VibeArt art={v.art} />
            <span className="vibe-why">{v.why}</span>
            <h4 className="display-sm">{v.title}</h4>
            <p>{v.blurb}</p>
            <button className="btn dark" disabled={v.people.length === 0} onClick={() => onOpen(v)}>
              {v.people.length === 0
                ? "No one here yet"
                : `See ${v.people.length} ${v.people.length === 1 ? "profile" : "profiles"}`}
            </button>
          </article>
        ))}
      </div>
      <div className="dots" role="tablist" aria-label="Choose a vibe">
        {vibes.map((v, i) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={i === at}
            aria-label={v.title}
            className={i === at ? "dot-btn on" : "dot-btn"}
            onClick={() => go(i)}
          />
        ))}
      </div>
    </section>
  );
}
