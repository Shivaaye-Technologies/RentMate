import type { Notice } from "../inbox";
import { shortTime } from "../inbox";
import { Icon } from "./Icon";
import { Photo } from "./Photo";

/** Recent activity from real records: likes, matches and unread messages. */
export function Notifications({
  notices,
  loading,
  error,
  onRetry,
  onOpen,
  onBack,
  onSettings,
}: {
  notices: Notice[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (n: Notice) => void;
  onBack: () => void;
  onSettings: () => void;
}) {
  return (
    <section aria-label="Notifications">
      <div className="page-head between">
        <div className="row">
          <button className="icon-btn" aria-label="Back" onClick={onBack}>
            <Icon name="back" />
          </button>
          <h2 className="display-sm">Notifications</h2>
        </div>
        <button className="btn small" onClick={onSettings}>
          <Icon name="settings" size={16} /> Settings
        </button>
      </div>
      {error && (
        <div className="empty small">
          <p className="alert error" role="alert">
            {error}
          </p>
          <button className="btn dark" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {!error && (loading || !notices) && (
        <div className="empty">
          <div className="spinner" aria-hidden="true" />
        </div>
      )}
      {!error && notices && notices.length === 0 && !loading && (
        <div className="empty small">
          <Icon name="bell" size={40} />
          <p className="muted">
            Nothing new yet. Likes, matches and messages will show up here. You can choose what appears in
            Settings.
          </p>
        </div>
      )}
      {!error && notices && notices.length > 0 && (
        <ul className="notice-list">
          {notices.map((n) => (
            <li key={n.id}>
              <button className={`notice ${n.kind}`} onClick={() => onOpen(n)}>
                <Photo
                  id={n.person.id}
                  name={n.person.displayName}
                  path={n.person.photoPath}
                  className="mini"
                  textSize={14}
                />
                <span>
                  <strong>{n.text}</strong>
                  <small className="muted">{shortTime(n.at)}</small>
                </span>
                <Icon
                  name={n.kind === "message" ? "chat" : n.kind === "super" ? "star" : "heart"}
                  size={18}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
