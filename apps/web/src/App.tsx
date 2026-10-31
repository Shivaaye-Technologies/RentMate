import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { DiscoverError, fetchDiscover, type DiscoverSummary, type Person } from "./api";
import { AccountPanel } from "./components/AccountPanel";
import { AuthScreen } from "./components/AuthScreen";
import { Chat } from "./components/Chat";
import { ChatsList } from "./components/ChatsList";
import { CrushStack } from "./components/CrushStack";
import { DiscoverHub } from "./components/DiscoverHub";
import { Icon, type IconName } from "./components/Icon";
import { LikesView, loadReceivedLikes } from "./components/LikesView";
import { Photo } from "./components/Photo";
import { ProfileExtras } from "./components/ProfileExtras";
import { ProfileForm } from "./components/ProfileForm";
import { SafetySheet } from "./components/SafetySheet";
import { MatchOverlay, ProfileSheet, SuperLikeSheet } from "./components/Sheets";
import { orderedPair, type ProfileRow } from "./profile";
import { friendlyError, type ReportReason } from "./safety";
import { clearPhotoCache, supabase, supabaseConfigured } from "./supabase";
import { loadDemoIds, setDemoIds } from "./demo";
import { touchLastSeen } from "./presence";
import { clearMyPasses, loadActivity, type Activity } from "./activity";
import { Onboarding } from "./components/Onboarding";
import { ProfileStrength, StrengthNudge } from "./components/ProfileStrength";
import { InviteButton } from "./components/InviteButton";
import { DemoMode } from "./demoMode/DemoMode";
import { CreatorStudio } from "./live/CreatorStudio";
import { AdminConsole } from "./live/AdminConsole";

/** Demo Mode lives at #demo so it can be linked from the landing page. */
const isDemoHash = () => typeof window !== "undefined" && window.location.hash === "#demo";
/** SOULMATE LIVE creator studio (signed-in members only). */
const isCreatorHash = () => typeof window !== "undefined" && window.location.hash === "#creator";
/** SOULMATE LIVE admin console (the database checks the admin/moderator role). */
const isAdminHash = () => typeof window !== "undefined" && window.location.hash === "#admin";

type Tab = "crush" | "discover" | "likes" | "chats" | "profile";
type Status = "loading" | "ready" | "error";

const TABS: { key: Exclude<Tab, "profile">; label: string; icon: IconName }[] = [
  { key: "crush", label: "Crush", icon: "cards" },
  { key: "discover", label: "Discover", icon: "grid" },
  { key: "likes", label: "Likes", icon: "heart" },
  { key: "chats", label: "Chats", icon: "chat" },
];

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [demo, setDemo] = useState(isDemoHash);
  const [creator, setCreator] = useState(isCreatorHash);
  const [admin, setAdmin] = useState(isAdminHash);

  useEffect(() => {
    const onHash = () => {
      setDemo(isDemoHash());
      setCreator(isCreatorHash());
      setAdmin(isAdminHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) {
    return (
      <main className="empty">
        <p className="alert error">
          This site is missing its Supabase settings (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).
        </p>
      </main>
    );
  }
  if (!ready) {
    return (
      <main className="empty full">
        <div className="spinner" aria-hidden="true" />
      </main>
    );
  }
  if (demo) {
    return (
      <DemoMode
        signedIn={session !== null}
        onExit={() => {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
          setDemo(false);
        }}
      />
    );
  }
  if (!session) return <AuthScreen />;
  if (admin) {
    return (
      <AdminConsole
        onExit={() => {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
          setAdmin(false);
        }}
      />
    );
  }
  if (creator) {
    return (
      <CreatorStudio
        me={session.user.id}
        onExit={() => {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
          setCreator(false);
        }}
      />
    );
  }
  return <Home key={session.user.id} session={session} />;
}

function Home({ session }: { session: Session }) {
  const me = session.user.id;
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("crush");

  const [people, setPeople] = useState<Person[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [slow, setSlow] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [peopleErrorStatus, setPeopleErrorStatus] = useState<number | null>(null);
  const [summary, setSummary] = useState<DiscoverSummary | null>(null);
  const [passed, setPassed] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [likesCount, setLikesCount] = useState(0);
  const [likesKey, setLikesKey] = useState(0);
  const [sheet, setSheet] = useState<{ person: Person; actions: boolean } | null>(null);
  const [superFor, setSuperFor] = useState<Person | null>(null);
  const [matched, setMatched] = useState<{ matchId: string; person: Person } | null>(null);
  const [chat, setChat] = useState<{ matchId: string; person: Person } | null>(null);
  const [safety, setSafety] = useState<{ person: Person; matchId: string | null } | null>(null);
  const [safetyBusy, setSafetyBusy] = useState(false);

  // Own profile.
  useEffect(() => {
    void supabase
      .rpc("get_my_profile")
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setLoadError(error.message);
        else setProfile((data as ProfileRow | null) ?? null);
        setLoaded(true);
      });
  }, [me]);

  // Online status: refresh last_seen_at while the app is open.
  const hasProfile = profile !== null;
  useEffect(() => {
    if (!hasProfile) return;
    const beat = () => void touchLastSeen(supabase, me);
    beat();
    const t = setInterval(beat, 2 * 60 * 1000);
    return () => clearInterval(t);
  }, [hasProfile, me]);

  const loadPeople = useCallback(async () => {
    setStatus("loading");
    setPeopleError(null);
    setPeopleErrorStatus(null);
    setSlow(false);
    // Free hosting sleeps when idle; explain if waking takes a while.
    const timer = setTimeout(() => setSlow(true), 4000);
    try {
      const result = await fetchDiscover(session.access_token);
      setPeople(result.people);
      setSummary(result.summary);
      setStatus("ready");
    } catch (e) {
      console.error("Discover failed", e);
      setPeopleError(e instanceof Error ? e.message : "Could not load people.");
      setPeopleErrorStatus(e instanceof DiscoverError ? e.status : null);
      setStatus("error");
    } finally {
      clearTimeout(timer);
    }
  }, [session.access_token]);

  useEffect(() => {
    if (hasProfile) void loadPeople();
  }, [hasProfile, loadPeople]);

  // Honest empty states: your own likes awaiting a reply and your passes.
  const [activity, setActivity] = useState<Activity | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const caughtUp = status === "ready" && people.length === 0;
  useEffect(() => {
    if (!hasProfile || !caughtUp) return;
    let cancelled = false;
    loadActivity(supabase, me)
      .then((a) => !cancelled && setActivity(a))
      // The empty state still explains itself without these counts.
      .catch((e: unknown) => console.error("Could not load your activity", e));
    return () => {
      cancelled = true;
    };
  }, [hasProfile, caughtUp, me, likesKey]);

  async function reviewPasses() {
    if (reviewing) return;
    setReviewing(true);
    try {
      const n = await clearMyPasses(supabase, me);
      setPassed([]);
      setActivity((a) => (a ? { ...a, passed: 0 } : a));
      await loadPeople();
      flash(n === 1 ? "1 passed profile is back in Discover." : `${n} passed profiles are back in Discover.`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not bring back passed profiles.");
    } finally {
      setReviewing(false);
    }
  }
  const emptyExtras = { activity, onReviewPasses: () => void reviewPasses(), reviewing };

  // Testers see a "Demo" label on fictional demo profiles.
  useEffect(() => {
    if (hasProfile) void loadDemoIds();
  }, [hasProfile, me]);

  // Likes badge count.
  useEffect(() => {
    if (!profile) return;
    loadReceivedLikes(me)
      .then((l) => setLikesCount(l.length))
      // The Likes tab shows this error itself; the badge just stays unchanged.
      .catch((e: unknown) => console.error("Could not count likes", e));
    // Only on first load and when likes are refreshed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasProfile, me, likesKey]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  async function decide(person: Person, kind: "like" | "pass" | "super", message: string | null = null) {
    if (busy) return;
    setBusy(true);
    const { error } =
      kind === "pass"
        ? await supabase.from("passes").insert({ passer_id: me, passed_id: person.id })
        : await supabase.from("likes").insert({
            liker_id: me,
            liked_id: person.id,
            is_super: kind === "super",
            message: kind === "super" ? message : null,
          });

    // 23505 = already recorded (double tap); anything else is a real problem.
    if (error && error.code !== "23505") {
      setBusy(false);
      flash(error.message);
      return;
    }

    setPeople((list) => list.filter((p) => p.id !== person.id));
    if (kind === "pass") setPassed((h) => [person, ...h].slice(0, 20));
    else {
      const [a, b] = orderedPair(me, person.id);
      const { data } = await supabase
        .from("matches")
        .select("id")
        .eq("user_a", a)
        .eq("user_b", b)
        .maybeSingle();
      if (data) setMatched({ matchId: data.id as string, person });
      else if (kind === "super") flash(`Super Like sent to ${person.displayName} ★`);
      setLikesKey((k) => k + 1);
    }
    setSuperFor(null);
    setSheet(null);
    setBusy(false);
  }

  async function rewind() {
    const last = passed[0];
    if (!last || busy) return;
    setBusy(true);
    const { error } = await supabase.from("passes").delete().eq("passer_id", me).eq("passed_id", last.id);
    setBusy(false);
    if (error) {
      flash(error.message);
      return;
    }
    setPassed((h) => h.slice(1));
    setPeople((list) => [last, ...list.filter((p) => p.id !== last.id)]);
    setTab("crush");
  }

  /** Drops someone from every list after a block or unmatch. */
  function forget(personId: string) {
    setPeople((list) => list.filter((p) => p.id !== personId));
    setPassed((h) => h.filter((p) => p.id !== personId));
    setSheet(null);
    setMatched(null);
    setChat((c) => (c && c.person.id === personId ? null : c));
    setLikesKey((k) => k + 1);
  }

  async function block(person: Person) {
    const { error } = await supabase.from("blocks").insert({ blocker_id: me, blocked_id: person.id });
    // 23505 = already blocked.
    if (error && error.code !== "23505") throw new Error(friendlyError(error.message));
  }

  async function runSafety(action: () => Promise<string>) {
    if (!safety || safetyBusy) return;
    setSafetyBusy(true);
    try {
      flash(await action());
      setSafety(null);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSafetyBusy(false);
    }
  }

  const report = (reason: ReportReason, details: string, alsoBlock: boolean) =>
    runSafety(async () => {
      const person = safety!.person;
      const { error } = await supabase
        .from("reports")
        .insert({ reporter_id: me, reported_id: person.id, reason, details });
      if (error) throw new Error(friendlyError(error.message));
      if (!alsoBlock) return "Thanks for reporting. We'll review it.";
      await block(person);
      forget(person.id);
      return `Thanks. ${person.displayName} is reported and blocked.`;
    });

  const blockOnly = () =>
    runSafety(async () => {
      const person = safety!.person;
      await block(person);
      forget(person.id);
      return `${person.displayName} is blocked.`;
    });

  const unmatch = () =>
    runSafety(async () => {
      const { person, matchId } = safety!;
      const { error } = await supabase.from("matches").delete().eq("id", matchId!);
      if (error) throw new Error(friendlyError(error.message));
      forget(person.id);
      return `You unmatched ${person.displayName}.`;
    });

  const signOut = () => {
    clearPhotoCache();
    setDemoIds([]);
    void supabase.auth.signOut();
  };

  const safetySheet = safety && (
    <SafetySheet
      person={safety.person}
      canUnmatch={safety.matchId !== null}
      busy={safetyBusy}
      onReport={(r, d, b) => void report(r, d, b)}
      onBlock={() => void blockOnly()}
      onUnmatch={() => void unmatch()}
      onClose={() => setSafety(null)}
    />
  );

  if (!loaded) {
    return (
      <main className="empty full">
        <div className="spinner" aria-hidden="true" />
      </main>
    );
  }
  if (loadError) {
    return (
      <main className="empty full">
        <p className="alert error">{loadError}</p>
        <button className="btn" onClick={signOut}>
          Sign out
        </button>
      </main>
    );
  }

  if (!profile) {
    return (
      <Onboarding
        userId={me}
        onSignOut={signOut}
        onDone={(row) => {
          setProfile(row);
          setTab("crush");
          flash(`Welcome to SOULMATE.AI, ${row.display_name}!`);
        }}
      />
    );
  }

  if (chat) {
    return (
      <main className="chat-shell">
        <Chat
          me={me}
          myProfile={profile}
          matchId={chat.matchId}
          person={chat.person}
          onBack={() => setChat(null)}
          onProfile={() => setSheet({ person: chat.person, actions: false })}
          onSafety={() => setSafety({ person: chat.person, matchId: chat.matchId })}
        />
        {sheet && (
          <ProfileSheet
            person={sheet.person}
            onClose={() => setSheet(null)}
            onSafety={() => setSafety({ person: sheet.person, matchId: chat.matchId })}
          />
        )}
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
        {safetySheet}
      </main>
    );
  }

  const peopleBody = (content: JSX.Element) => {
    if (status === "loading") {
      return (
        <div className="empty">
          <div className="spinner" aria-hidden="true" />
          <p>Finding people for you…</p>
          {slow && <p className="muted">Waking up the server. This can take up to a minute.</p>}
        </div>
      );
    }
    if (status === "error") {
      return (
        <div className="empty">
          <p className="alert error" role="alert">
            {peopleError}
          </p>
          {peopleErrorStatus === 401 ? (
            <button className="btn dark" onClick={signOut}>
              Sign in again
            </button>
          ) : (
            <button className="btn dark" onClick={() => void loadPeople()}>
              Try again
            </button>
          )}
        </div>
      );
    }
    return content;
  };

  return (
    <div className={tab === "discover" ? "app dark-top" : "app"}>
      <header className="topbar">
        <span className="brand">
          <span className="logo-mark small" aria-hidden="true">
            <Icon name="heart" size={14} />
          </span>
          SOULMATE.AI
        </span>
        <button
          className={tab === "profile" ? "me-btn active" : "me-btn"}
          aria-label="Your profile"
          onClick={() => setTab("profile")}
        >
          <Photo
            id={profile.id}
            name={profile.display_name}
            path={profile.photo_path}
            className="mini"
            textSize={13}
          />
        </button>
      </header>

      <main className={tab === "discover" ? "shell flush" : "shell"}>
        {tab === "crush" &&
          peopleBody(
            <>
              <StrengthNudge profile={profile} onOpen={() => setTab("profile")} />
              <CrushStack
                people={people}
                summary={summary}
                emptyExtras={emptyExtras}
                onEditProfile={() => setTab("profile")}
                busy={busy}
                canRewind={passed.length > 0}
                onPass={(p) => void decide(p, "pass")}
                onLike={(p) => void decide(p, "like")}
                onSuper={(p) => setSuperFor(p)}
                onRewind={() => void rewind()}
                onRefresh={() => void loadPeople()}
              />
            </>,
          )}

        {tab === "discover" &&
          peopleBody(
            <DiscoverHub
              people={people}
              summary={summary}
              emptyExtras={emptyExtras}
              onEditProfile={() => setTab("profile")}
              likesCount={likesCount}
              onOpenLikes={() => setTab("likes")}
              onOpen={(p) => setSheet({ person: p, actions: true })}
            />,
          )}

        {tab === "likes" && (
          <LikesView
            me={me}
            refreshKey={likesKey}
            onCount={setLikesCount}
            onOpen={(l) => setSheet({ person: l.person, actions: true })}
          />
        )}

        {tab === "chats" && (
          <ChatsList me={me} onOpen={(m) => setChat({ matchId: m.matchId, person: m.person })} />
        )}

        {tab === "profile" && (
          <>
            <ProfileStrength profile={profile} />
            <ProfileExtras profile={profile} onChange={(patch) => setProfile({ ...profile, ...patch })} />
            <ProfileForm
              userId={me}
              initial={profile}
              title="About you"
              submitLabel="Save changes"
              onSaved={(row) => {
                setProfile({ ...profile, ...row });
                void loadPeople();
              }}
            />
            <a className="demo-entry" href="#creator">
              <Icon name="star" size={18} />
              <span>
                <strong>SOULMATE LIVE creator studio</strong>
                <small>Apply to broadcast, verify, schedule streams and manage consent.</small>
              </span>
            </a>
            <a className="demo-entry" href="#demo">
              <Icon name="sparkle" size={18} />
              <span>
                <strong>Explore Demo Mode</strong>
                <small>Try likes, matches and chat with 100+ fictional profiles. Nothing is shared.</small>
              </span>
            </a>
            <div className="panel invite-panel">
              <h2 className="display-sm">Bring your friends</h2>
              <p className="muted">
                SOULMATE.AI grows one real person at a time. Share the link; there is no tracking or referral
                code.
              </p>
              <InviteButton className="btn dark" />
            </div>
            <AccountPanel email={session.user.email} photoPath={profile.photo_path} onSignOut={signOut} />
          </>
        )}
      </main>

      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            aria-current={tab === t.key ? "page" : undefined}
            aria-label={t.label}
            onClick={() => setTab(t.key)}
          >
            <Icon name={t.icon} size={24} />
            {t.key === "likes" && likesCount > 0 && <i className="badge-dot" />}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {sheet && (
        <ProfileSheet
          person={sheet.person}
          onClose={() => setSheet(null)}
          onSafety={() => setSafety({ person: sheet.person, matchId: null })}
          onPass={sheet.actions ? () => void decide(sheet.person, "pass") : undefined}
          onLike={sheet.actions ? () => void decide(sheet.person, "like") : undefined}
          onSuper={
            sheet.actions
              ? () => {
                  setSuperFor(sheet.person);
                  setSheet(null);
                }
              : undefined
          }
        />
      )}

      {superFor && (
        <SuperLikeSheet
          person={superFor}
          busy={busy}
          onClose={() => setSuperFor(null)}
          onSend={(msg) => void decide(superFor, "super", msg)}
        />
      )}

      {safetySheet}

      {matched && (
        <MatchOverlay
          person={matched.person}
          onClose={() => setMatched(null)}
          onProfile={() => {
            setSheet({ person: matched.person, actions: false });
            setMatched(null);
          }}
          onChat={() => {
            setChat({ matchId: matched.matchId, person: matched.person });
            setMatched(null);
          }}
        />
      )}
    </div>
  );
}
