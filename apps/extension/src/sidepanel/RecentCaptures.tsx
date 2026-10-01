import type { CaptureView } from "../lib/api";

type Props = {
  items: CaptureView[];
  currentId?: string;
  onSelect: (capture: CaptureView) => void;
};

export function RecentCaptures({ items, currentId, onSelect }: Props) {
  if (items.length === 0) return null;
  return (
    <section className="recent">
      <h2>Recent captures</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button
              className={item.id === currentId ? "recent-item active" : "recent-item"}
              onClick={() => onSelect(item)}
            >
              <span className="recent-title">
                {item.summary
                  ? `${item.summary.title} · ${item.summary.company}`
                  : (item.pageTitle ?? "Untitled capture")}
              </span>
              <span className="muted">
                {item.summary ? `${item.summary.scoreTotal}/100` : item.status}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
