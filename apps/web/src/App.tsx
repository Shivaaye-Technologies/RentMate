import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { DiscoverError, fetchDiscover, personFromOwnRow, type DiscoverSummary, type Person } from "./api";
import { AuthScreen, NewPasswordScreen } from "./components/AuthScreen";
import { hasAuthParams, parseAuthRedirect, type AuthProblem } from "./auth";
import { Chat } from "./components/Chat";
import { ChatsList } from "./components/ChatsList";
import { CrushStack } from "./components/CrushStack";
import { DiscoverHub } from "./components/DiscoverHub";
import { Icon, type IconName } from "./components/Icon";
import { LikesView, loadReceivedLikes } from "./components/LikesView";
import { Photo } from "./components/Photo";
import { SafetySheet } from "./components/SafetySheet";
import { MatchOverlay, ProfileSheet, SuperLikeSheet } from "./components/Sheets";
import { orderedPair, type ProfileRow } from "./profile";
import { friendlyError, type ReportReason } from "./safety";
import { clearPhotoCache, supabase, supabaseConfigured } from "./supabase";
import { loadDemoIds, setDemoIds } from "./demo";
import { touchLastSeen } from "./presence";
import { clearMyPasses, loadActivity, type Activity } from "./activity";
import { Onboarding } from "./components/Onboarding";
import { StrengthNudge } from "./components/ProfileStrength";
import { ProfileDashboard, type DashboardPage } from "./components/ProfileDashboard";
import { MapView } from "./components/MapView";
import { Notifications } from "./components/Notifications";
import { SafetyIntro } from "./components/SafetyIntro";
import { alertsFor, buildNotices, loadMatches, type Counts, type Notice } from "./inbox";
import { showAlert } from "./notify";
import { saveProfileFields, type ProfilePatch } from "./profileApi";
import { DemoMode } from "./demoMode/DemoMode";

/** Demo Mode lives at #demo so it can be linked from the landing page. */
const isDemoHash = () => typeof window !== "undefined" && window.location.hash === "#demo";

type Tab = "crush" | "discover" | "likes" | "chats" | "profile";
type Status = "loading" | "ready" | "error";

const TABS: { key: Exclude<Tab, "profile">; label: string; icon: IconName }[] = [
  { key: "crush", label: "Crush", icon: "cards" },
  { key: "discover", label: "Discover", icon: "grid" },
  { key: "likes", label: "Likes", icon: "heart" },
  { key: "chats", label: "Chats", icon: "chat" },
];

/** Email links come back with parameters in the URL; read them once at start-up. */
const startRedirect =
  typeof window === "undefined"
    ? { type: null, problem: null }
    : parseAuthRedirect(window.location.hash, window.location.search);

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [demo, setDemo] = useState(isDemoHash);
  const [recovery, setRecovery] = useState(startRedirect.type === "recovery");
  const [linkProblem] = useState<AuthProblem | null>(startRedirect.problem);

  useEffect(() => {
    const onHash = () => setDemo(isDemoHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
      // The client has read any tokens from the link; tidy the address bar.
      const { hash, search, pathname } = window.location;
      if (hasAuthParams(hash, search)) window.history.replaceState(null, "", pathname);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s);
    });
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
  if (recovery && session) return <NewPasswordScreen onDone={() => setRecovery(false)} />;
  if (!session) return <AuthScreen initialProblem={linkProblem} />;
  return <Home key={session.user.id} session={session} />;
}

function Home({ session }: { session: Session }) {
  const me = session.user.id;
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("crush");
  const [dashPage, setDashPage] = useState<DashboardPage | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [cityVibe, setCityVibe] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [safetyIntro, setSafetyIntro] = useState(false);
  const [preview, setPreview] = useState(false);

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

  // Existing members see the safety introduction once (only when the database records it).
  const needsSafetyIntro = !!profile && "safety_intro_at" in profile && !profile.safety_intro_at;
  useEffect(() => {
    if (needsSafetyIntro) setSafetyIntro(true);
  }, [needsSafetyIntro]);

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

  // Notifications: real likes, matches and unread messages, refreshed every minute.
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [noticesLoading, setNoticesLoading] = useState(false);
  const [noticesError, setNoticesError] = useState<string | null>(null);
  const [unread, setUnread] = useState<number | null>(null);
  const [seenAt, setSeenAt] = useState<string>(() => {
    try {
      return localStorage.getItem(`soulmate-notices-seen-${me}`) ?? "";
    } catch {
      return "";
    }
  });
  const lastCounts = useRef<Counts | null>(null);
  const prefs = profile?.notify_prefs ?? null;

  const refreshActivity = useCallback(async () => {
    setNoticesLoading(true);
    try {
      const [likes, matches] = await Promise.all([loadReceivedLikes(me), loadMatches(me)]);
      const list = buildNotices(likes, matches, prefs);
      setNotices(list);
      setNoticesError(null);
      setLikesCount(likes.length);
      const known = matches.every((m) => m.unread !== null);
      const totalUnread = known ? matches.reduce((n, m) => n + (m.unread ?? 0), 0) : null;
      setUnread(totalUnread);
      const counts = { likes: likes.length, matches: matches.length, unread: totalUnread ?? 0 };
      for (const text of alertsFor(lastCounts.current, counts, prefs)) showAlert(text);
      lastCounts.current = counts;
    } catch (e) {
      setNoticesError(e instanceof Error ? e.message : "Could not load notifications.");
    } finally {
      setNoticesLoading(false);
    }
  }, [me, prefs]);

  useEffect(() => {
    if (!hasProfile) return;
    void refreshActivity();
    const t = setInterval(() => void refreshActivity(), 60 * 1000);
    const onVisible = () => document.visibilityState === "visible" && void refreshActivity();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hasProfile, refreshActivity, likesKey]);

  const unseen = (notices ?? []).filter((n) => n.at > seenAt).length;
  const openNotices = () => {
    setNoticesOpen(true);
    const newest = notices?.[0]?.at ?? new Date().toISOString();
    setSeenAt(newest);
    try {
      localStorage.setItem(`soulmate-notices-seen-${me}`, newest);
    } catch {
      // Without storage the bell resets on reload; nothing else depends on it.
    }
  };

  const patchProfile = (patch: ProfilePatch) =>
    setProfile((p) => (p ? ({ ...p, ...patch } as ProfileRow) : p));

  async function finishSafetyIntro() {
    setSafetyIntro(false);
    const at = new Date().toISOString();
    patchProfile({ safety_intro_at: at });
    await saveProfileFields(me, { safety_intro_at: at }).catch((e: unknown) =>
      console.error("Could not save safety introduction", e),
    );
  }

  async function dismissWelcome() {
    const at = new Date().toISOString();
    patchProfile({ welcome_seen_at: at });
    await saveProfileFields(me, { welcome_seen_at: at }).catch((e: unknown) =>
      console.error("Could not save welcome", e),
    );
  }

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
          setProfile({ ...row, safety_intro_at: null, welcome_seen_at: null });
          setTab("crush");
          setSafetyIntro(true);
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
          onBack={() => {
            setChat(null);
            void refreshActivity();
          }}
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

  const goTab = (t: Tab) => {
    setTab(t);
    setMapOpen(false);
    setNoticesOpen(false);
    if (t !== "profile") setDashPage(null);
  };
  const myCity = typeof profile.city === "string" ? profile.city : null;
  const overlayPage = noticesOpen ? "notices" : mapOpen && tab === "discover" ? "map" : null;

  return (
    <div className={tab === "discover" && !overlayPage ? "app dark-top" : "app"}>
      <header className="topbar">
        <span className="brand">
          <span className="logo-mark small" aria-hidden="true">
            <Icon name="heart" size={14} />
          </span>
          SOULMATE.AI
        </span>
        <span className="topbar-actions">
          <button
            className={noticesOpen ? "bell-btn active" : "bell-btn"}
            aria-label={unseen > 0 ? `Notifications, ${unseen} new` : "Notifications"}
            onClick={openNotices}
          >
            <Icon name="bell" size={20} />
            {unseen > 0 && <i className="badge-dot" />}
          </button>
          <button
            className={tab === "profile" ? "me-btn active" : "me-btn"}
            aria-label="Your profile"
            onClick={() => goTab("profile")}
          >
            <Photo
              id={profile.id}
              name={profile.display_name}
              path={profile.photo_path}
              className="mini"
              textSize={13}
            />
          </button>
        </span>
      </header>

      <main className={tab === "discover" && !overlayPage ? "shell flush" : "shell"}>
        {overlayPage === "notices" && (
          <Notifications
            notices={notices}
            loading={noticesLoading}
            error={noticesError}
            onRetry={() => void refreshActivity()}
            onBack={() => setNoticesOpen(false)}
            onSettings={() => {
              setNoticesOpen(false);
              setTab("profile");
              setDashPage("notifications");
            }}
            onOpen={(n) => {
              setNoticesOpen(false);
              if (n.matchId && n.kind !== "like" && n.kind !== "super") {
                setChat({ matchId: n.matchId, person: n.person });
              } else setSheet({ person: n.person, actions: true });
            }}
          />
        )}

        {overlayPage === "map" && (
          <MapView
            me={profile}
            people={people}
            onBack={() => setMapOpen(false)}
            onOpenPrivacy={() => {
              setMapOpen(false);
              setTab("profile");
              setDashPage("privacy");
            }}
            onShowCity={() => {
              setMapOpen(false);
              setCityVibe(true);
            }}
          />
        )}

        {!overlayPage &&
          tab === "crush" &&
          peopleBody(
            <>
              <StrengthNudge profile={profile} onOpen={() => goTab("profile")} />
              <CrushStack
                people={people}
                summary={summary}
                emptyExtras={emptyExtras}
                onEditProfile={() => {
                  goTab("profile");
                  setDashPage("preferences");
                }}
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

        {!overlayPage &&
          tab === "discover" &&
          peopleBody(
            <DiscoverHub
              key={cityVibe ? "city" : "all"}
              people={people}
              summary={summary}
              emptyExtras={emptyExtras}
              onEditProfile={() => {
                goTab("profile");
                setDashPage("preferences");
              }}
              likesCount={likesCount}
              onOpenLikes={() => goTab("likes")}
              onOpen={(p) => setSheet({ person: p, actions: true })}
              me={{ interests: profile.interests ?? [], city: myCity }}
              onOpenMap={() => setMapOpen(true)}
              initialVibe={cityVibe ? "local" : null}
            />,
          )}

        {!overlayPage && tab === "likes" && (
          <LikesView
            me={me}
            refreshKey={likesKey}
            onCount={setLikesCount}
            onOpen={(person, actions) => setSheet({ person, actions })}
            onOpenMatch={(m) => setChat({ matchId: m.matchId, person: m.person })}
          />
        )}

        {!overlayPage && tab === "chats" && (
          <ChatsList
            me={me}
            showWelcome={"welcome_seen_at" in profile && !profile.welcome_seen_at}
            onDismissWelcome={() => void dismissWelcome()}
            onUnread={setUnread}
            onOpen={(m) => setChat({ matchId: m.matchId, person: m.person })}
          />
        )}

        {!overlayPage && tab === "profile" && (
          <ProfileDashboard
            profile={profile}
            email={session.user.email}
            page={dashPage}
            onPage={setDashPage}
            onChange={(patch) => {
              patchProfile(patch);
              // Age range and visibility change who you see.
              if ("age_min" in patch || "age_max" in patch || "interests" in patch || "city" in patch) {
                void loadPeople();
              }
            }}
            onPreview={() => setPreview(true)}
            onSafetyIntro={() => setSafetyIntro(true)}
            onSignOut={signOut}
          />
        )}
      </main>

      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key && !overlayPage ? "active" : ""}
            aria-current={tab === t.key ? "page" : undefined}
            aria-label={
              t.key === "chats" && unread
                ? `${t.label}, ${unread} unread`
                : t.key === "likes" && likesCount > 0
                  ? `${t.label}, ${likesCount} new`
                  : t.label
            }
            onClick={() => goTab(t.key)}
          >
            <Icon name={t.icon} size={24} />
            {t.key === "likes" && likesCount > 0 && <i className="badge-dot" />}
            {t.key === "chats" && !!unread && <b className="tab-count">{unread > 9 ? "9+" : unread}</b>}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {preview && <ProfileSheet person={personFromOwnRow(profile)} onClose={() => setPreview(false)} />}

      {safetyIntro && (
        <SafetyIntro onFinish={() => void finishSafetyIntro()} onClose={() => setSafetyIntro(false)} />
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
