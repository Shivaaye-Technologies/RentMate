import { useState } from "react";
import { detailsFromRow } from "../details";
import {
  allPhotos,
  profileStrength,
  type ProfileRow,
  type ProfileSection,
  type StrengthItem,
} from "../profile";
import type { ProfilePatch } from "../profileApi";
import { AccountPanel } from "./AccountPanel";
import { Icon, VerifiedBadge, type IconName } from "./Icon";
import { InviteButton } from "./InviteButton";
import { Photo } from "./Photo";
import { PhotoManager } from "./PhotoManager";
import { ProfileEditor, SECTION_TITLES, type EditSection } from "./ProfileEditor";
import { BlockedList, HelpSafety, NotificationSettings, PrivacySettings } from "./Settings";
import { ThemeToggle } from "./ThemeToggle";
import { WalletPanel } from "./WalletPanel";

export type DashboardPage =
  EditSection | "photos" | "notifications" | "privacy" | "blocked" | "help" | "account";

const PAGE_TITLES: Record<DashboardPage, string> = {
  ...SECTION_TITLES,
  photos: "Photos",
  notifications: "Notifications",
  privacy: "Location and visibility",
  blocked: "Blocked people",
  help: "Help and safety",
  account: "Account",
};

/** Completion tasks open the matching editor. */
const TASK_PAGE: Record<ProfileSection, DashboardPage> = {
  photos: "photos",
  about: "about",
  interests: "interests",
  prompts: "prompts",
  lifestyle: "lifestyle",
  places: "places",
  privacy: "privacy",
};

const MENU: { page: DashboardPage; icon: IconName; hint: string }[][] = [
  [
    { page: "photos", icon: "camera", hint: "Add, reorder and choose your main photo" },
    { page: "about", icon: "edit", hint: "Name, age and bio" },
    { page: "prompts", icon: "quote", hint: "Up to three answers" },
    { page: "interests", icon: "heart", hint: "Up to 10" },
    { page: "lifestyle", icon: "user", hint: "Height, work, education, habits" },
    { page: "places", icon: "pin", hint: "Your city and favourite spots" },
  ],
  [
    { page: "preferences", icon: "users", hint: "Who you'd like to meet and ages" },
    { page: "notifications", icon: "bell", hint: "Likes, matches, messages" },
    { page: "privacy", icon: "lock", hint: "Distance and pausing your profile" },
    { page: "blocked", icon: "x", hint: "Unblock people" },
    { page: "help", icon: "shield", hint: "Safety tips, policies" },
    { page: "account", icon: "settings", hint: "Sign out or delete your account" },
  ],
];

/** Profile completion with To do / Done filters. */
function Completion({ profile, onOpen }: { profile: ProfileRow; onOpen: (page: DashboardPage) => void }) {
  const { score, total, percent, items } = profileStrength(profile);
  const [filter, setFilter] = useState<"todo" | "done">(score >= total ? "done" : "todo");
  const shown = items.filter((i) => (filter === "done" ? i.done : !i.done));
  const row = (i: StrengthItem) => (
    <li key={i.key}>
      <button className={i.done ? "task done" : "task"} onClick={() => onOpen(TASK_PAGE[i.section])}>
        <Icon name={i.done ? "check" : "plus"} size={18} />
        <span>
          <strong>{i.label}</strong>
          {!i.done && i.hint && <small className="muted">{i.hint}</small>}
        </span>
        <Icon name="chevron" size={16} />
      </button>
    </li>
  );
  return (
    <section className="panel completion" aria-label="Profile completion">
      <div className="strength-head">
        <h2 className="display-sm">Profile {percent}% complete</h2>
        <strong>
          {score}/{total}
        </strong>
      </div>
      <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="segmented small" role="tablist" aria-label="Tasks">
        <button
          role="tab"
          aria-selected={filter === "todo"}
          className={filter === "todo" ? "active" : ""}
          onClick={() => setFilter("todo")}
        >
          To do ({total - score})
        </button>
        <button
          role="tab"
          aria-selected={filter === "done"}
          className={filter === "done" ? "active" : ""}
          onClick={() => setFilter("done")}
        >
          Done ({score})
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="muted small">
          {filter === "todo" ? "Everything is done. Nice work!" : "Nothing done yet."}
        </p>
      ) : (
        <ul className="task-list">{shown.map(row)}</ul>
      )}
    </section>
  );
}

export function ProfileDashboard({
  profile,
  email,
  page,
  onPage,
  onChange,
  onPreview,
  onSafetyIntro,
  onSignOut,
}: {
  profile: ProfileRow;
  email: string | undefined;
  page: DashboardPage | null;
  onPage: (p: DashboardPage | null) => void;
  onChange: (patch: ProfilePatch) => void;
  onPreview: () => void;
  onSafetyIntro: () => void;
  onSignOut: () => void;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const city = detailsFromRow(profile as Parameters<typeof detailsFromRow>[0]).city;

  if (page) {
    const back = () => onPage(null);
    const editable = page in SECTION_TITLES;
    return (
      <section className="dash-page" aria-label={PAGE_TITLES[page]}>
        <div className="page-head">
          <button className="icon-btn" aria-label="Back to profile" onClick={back}>
            <Icon name="back" />
          </button>
          <h2 className="display-sm">{PAGE_TITLES[page]}</h2>
        </div>
        {editable && (
          <ProfileEditor
            section={page as EditSection}
            profile={profile}
            onCancel={back}
            onSaved={(patch) => {
              onChange(patch);
              setSaved(`${PAGE_TITLES[page]} saved.`);
              back();
            }}
          />
        )}
        {page === "photos" && <PhotoManager profile={profile} onChange={onChange} />}
        {page === "notifications" && <NotificationSettings profile={profile} onChange={onChange} />}
        {page === "privacy" && <PrivacySettings profile={profile} onChange={onChange} />}
        {page === "blocked" && <BlockedList me={profile.id} />}
        {page === "help" && <HelpSafety onSafetyIntro={onSafetyIntro} />}
        {page === "account" && (
          <AccountPanel
            userId={profile.id}
            email={email}
            photoPaths={allPhotos(profile)}
            onSignOut={onSignOut}
          />
        )}
      </section>
    );
  }

  return (
    <section className="dashboard">
      <div className="panel dash-head">
        <div className="me-photo">
          <Photo id={profile.id} name={profile.display_name} path={profile.photo_path} textSize={36} />
          <button className="cam" aria-label="Manage photos" onClick={() => onPage("photos")}>
            <Icon name="camera" size={18} />
          </button>
        </div>
        <div className="dash-who">
          <h2 className="display-sm">
            {profile.display_name}, {profile.age} {profile.verified && <VerifiedBadge size={20} />}
          </h2>
          <p className="muted small">
            {city ? `${city} · ` : ""}
            {profile.hidden ? "Profile paused" : "Visible in Discover"}
          </p>
          <div className="row-wrap">
            <button className="btn small dark" onClick={onPreview}>
              <Icon name="eye" size={16} /> View profile
            </button>
            <button className="btn small" onClick={() => onPage("about")}>
              <Icon name="edit" size={16} /> Edit profile
            </button>
          </div>
        </div>
      </div>
      {saved && (
        <p className="alert info" role="status">
          {saved}
        </p>
      )}

      <Completion profile={profile} onOpen={onPage} />

      {MENU.map((group, gi) => (
        <nav key={gi} className="panel menu" aria-label={gi === 0 ? "Your profile" : "Settings"}>
          {group.map((m) => (
            <button key={m.page} className="menu-row" onClick={() => onPage(m.page)}>
              <Icon name={m.icon} size={20} />
              <span>
                <strong>{PAGE_TITLES[m.page]}</strong>
                <small className="muted">{m.hint}</small>
              </span>
              <Icon name="chevron" size={18} />
            </button>
          ))}
        </nav>
      ))}

      <a className="demo-entry" href="#companions">
        <Icon name="star" size={18} />
        <span>
          <strong>Find a companion</strong>
          <small>
            Book verified companions for coffee, meals, events and city walks. Non-sexual, public places only.
          </small>
        </span>
      </a>
      <a className="demo-entry" href="#companion">
        <Icon name="sparkle" size={18} />
        <span>
          <strong>Become a companion</strong>
          <small>Offer friendly company for public activities, set your prices and availability.</small>
        </span>
      </a>
      <a className="demo-entry" href="#live">
        <Icon name="bolt" size={18} />
        <span>
          <strong>Watch live</strong>
          <small>Streams from approved creators, with chat. Nothing is recorded.</small>
        </span>
      </a>
      <a className="demo-entry" href="#creator">
        <Icon name="star" size={18} />
        <span>
          <strong>RentMate Live creator studio</strong>
          <small>Apply to broadcast, verify, schedule streams and manage consent.</small>
        </span>
      </a>
      <a className="demo-entry" href="#demo">
        <Icon name="sparkle" size={18} />
        <span>
          <strong>Explore Demo Mode</strong>
          <small>Try likes, matches and chat with fictional profiles. Nothing is shared.</small>
        </span>
      </a>
      <div className="panel invite-panel">
        <h2 className="display-sm">Bring your friends</h2>
        <p className="muted">
          RentMate grows one real person at a time. Share the link; there is no tracking or referral code.
        </p>
        <InviteButton className="btn dark" />
      </div>
      <WalletPanel me={profile.id} />
      <div className="panel appearance-panel">
        <h2 className="display-sm">Appearance</h2>
        <ThemeToggle />
      </div>
      <nav className="legal-links" aria-label="Legal">
        <a href="/privacy.html">Privacy Policy</a>
        <a href="/terms.html">Terms of Use</a>
        <a href="/safety.html">Dating safety</a>
      </nav>
    </section>
  );
}
