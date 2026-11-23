import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAction } from "../live/useAction";
import { marketError } from "./marketText";

type ConfigType = "token_pricing" | "tax_rule";
interface FinancialConfig {
  id: string;
  config_type: ConfigType;
  payload: Record<string, unknown>;
  effective_at: string;
  reason: string;
  created_by: string;
  created_at: string;
  approval_count: number;
  approver_id: string | null;
  decision: string | null;
  status: "awaiting_approval" | "scheduled" | "active" | "rejected";
}
const pricingExample = JSON.stringify(
  {
    currency: "INR",
    tax_inclusive: false,
    packages: [{ code: "starter", tokens: 100, price_paise: 15000, bonus_tokens: 0 }],
  },
  null,
  2,
);
const taxExample = JSON.stringify(
  {
    country_code: "IN",
    state_code: "DL",
    tax_category: "REVIEW_WITH_TAX_ADVISER",
    tax_name: "Applicable indirect tax",
    rate_bps: -1, // INVALID PLACEHOLDER: replace only with adviser-confirmed basis points.
    treatment: "exclusive",
    tax_review: {
      reviewer_name: "Enter reviewer's full name",
      qualification: "Enter professional tax qualification",
      organization: "Enter reviewing organization",
      reviewed_on: "2026-11-20",
      jurisdiction: "India - Delhi",
      supply_scope: "Describe the supply reviewed",
      customer_scope: "Describe the customer types reviewed",
      evidence_reference: "Enter internal advice/document reference",
    },
  },
  null,
  2,
);

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(marketError(error));
  return data as T;
}

/** Admin-only, two-person approval workflow for immutable pricing and tax configuration versions. */
export function FinancialConfigAdmin() {
  const [rows, setRows] = useState<FinancialConfig[] | null>(null);
  const [configType, setConfigType] = useState<ConfigType>("token_pricing");
  const [payload, setPayload] = useState(pricingExample);
  const [effectiveAt, setEffectiveAt] = useState(() => {
    const date = new Date(Date.now() + 60_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    try {
      setRows(await rpc<FinancialConfig[]>("admin_list_financial_configs"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load financial configurations.");
    }
  }, []);
  const { busy, run, messages } = useAction(reload);
  useEffect(() => {
    void reload();
  }, [reload]);

  const propose = async (event: React.FormEvent) => {
    event.preventDefault();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
        throw new Error("JSON must be an object.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON configuration.");
      return;
    }
    setError(null);
    await run(
      () =>
        rpc<string>("admin_propose_financial_config", {
          p_config_type: configType,
          p_payload: parsed,
          p_effective_at: new Date(effectiveAt).toISOString(),
          p_reason: reason.trim(),
        }),
      "Configuration proposed. A different administrator must approve it before it takes effect.",
    );
    setReason("");
  };

  const decide = (id: string, decision: "approved" | "rejected", note: string) => {
    const row = rows?.find((item) => item.id === id);
    const minimum = row?.config_type === "tax_rule" ? 20 : 5;
    if (note.trim().length < minimum) {
      setError(`Enter at least ${minimum} characters explaining this decision.`);
      return;
    }
    setError(null);
    void run(
      () =>
        rpc("admin_approve_financial_config", {
          p_config_id: id,
          p_decision: decision,
          p_note: note.trim(),
        }),
      decision === "approved"
        ? "Approved. It becomes effective at its scheduled time."
        : "Proposal rejected.",
    );
  };

  return (
    <section className="studio-section">
      <div className="panel">
        <h3>Token pricing & tax configuration</h3>
        <p className="muted small">
          Changes are versioned and immutable. The proposer cannot approve their own change; a second
          administrator must approve. Existing token balances and historical transaction snapshots are never
          repriced.
        </p>
        <p className="alert info small">
          Tax rules require professional review for the relevant country, state, supply and customer type. No
          tax rate is preselected as a legal default. Purchases and payouts remain disabled until separately
          authorized.
        </p>
        {configType === "tax_rule" && (
          <p className="alert warning small" role="alert">
            The -1 rate is an invalid placeholder, not a 0% tax rate. Replace it only with the rate confirmed
            by a qualified tax adviser. Example reviewer details are placeholders, not evidence of an actual
            review.
          </p>
        )}
        <form className="form" onSubmit={(e) => void propose(e)}>
          <label className="field">
            <span>Configuration type</span>
            <select
              value={configType}
              onChange={(e) => {
                const next = e.target.value as ConfigType;
                setConfigType(next);
                setPayload(next === "token_pricing" ? pricingExample : taxExample);
              }}
            >
              <option value="token_pricing">Token packages & pricing</option>
              <option value="tax_rule">Jurisdiction tax rule</option>
            </select>
          </label>
          <label className="field">
            <span>Configuration JSON</span>
            <textarea
              required
              rows={configType === "token_pricing" ? 10 : 9}
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Effective date and time</span>
            <input
              required
              type="datetime-local"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Reason for change</span>
            <input
              required
              minLength={5}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Approved pricing review / tax advice reference"
            />
          </label>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          {messages}
          <button className="btn dark" disabled={busy || reason.trim().length < 5 || !effectiveAt}>
            Submit for second-admin approval
          </button>
        </form>
      </div>

      <div className="panel">
        <h3>Configuration history & approvals</h3>
        {!rows ? (
          <div className="spinner" aria-hidden="true" />
        ) : rows.length === 0 ? (
          <p className="muted">No financial configuration versions yet.</p>
        ) : (
          <ul className="admin-list">
            {rows.map((row) => (
              <li key={row.id}>
                <div className="row between">
                  <strong>{row.config_type === "token_pricing" ? "Token pricing" : "Tax rule"}</strong>
                  <span className="pill">{row.status.replaceAll("_", " ")}</span>
                </div>
                <p className="small muted">
                  Effective {new Date(row.effective_at).toLocaleString()} · Proposed{" "}
                  {new Date(row.created_at).toLocaleString()}
                </p>
                <p className="small">{row.reason}</p>
                <pre className="small">{JSON.stringify(row.payload, null, 2)}</pre>
                <p className="small muted">
                  {row.approval_count} approval · proposer {row.created_by}
                </p>
                {row.status === "awaiting_approval" && (
                  <div className="form">
                    <label className="field">
                      <span>
                        {row.config_type === "tax_rule"
                          ? "Independent tax review decision note (minimum 20 characters)"
                          : "Independent review decision note"}
                      </span>
                      <textarea
                        rows={3}
                        value={approvalNotes[row.id] ?? ""}
                        onChange={(e) =>
                          setApprovalNotes((current) => ({
                            ...current,
                            [row.id]: e.target.value,
                          }))
                        }
                        placeholder="Describe the evidence reviewed and the reason for your decision"
                      />
                    </label>
                    <div className="row-wrap">
                      <button
                        className="btn small dark"
                        disabled={
                          busy ||
                          (approvalNotes[row.id] ?? "").trim().length <
                            (row.config_type === "tax_rule" ? 20 : 5)
                        }
                        onClick={() => decide(row.id, "approved", approvalNotes[row.id] ?? "")}
                      >
                        Approve
                      </button>
                      <button
                        className="btn small danger"
                        disabled={
                          busy ||
                          (approvalNotes[row.id] ?? "").trim().length <
                            (row.config_type === "tax_rule" ? 20 : 5)
                        }
                        onClick={() => decide(row.id, "rejected", approvalNotes[row.id] ?? "")}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
