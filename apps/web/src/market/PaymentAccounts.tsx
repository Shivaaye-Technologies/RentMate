import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAction } from "../live/useAction";
import { marketError } from "./marketText";

type Method = "card" | "upi";
type Provider = "razorpay" | "cashfree" | "payu" | "upi_psp";
interface PaymentAccount {
  id: string;
  payment_method: Method;
  provider_key: Provider;
  display_name: string;
  merchant_reference: string;
  environment: "test" | "live";
  currency: "INR";
  priority: number;
  min_amount_paise: number;
  max_amount_paise: number;
  upi_vpa: string | null;
  dynamic_qr_supported: boolean;
  status: string;
  last_tested_at: string | null;
  last_test_status: string | null;
  secret_configured: boolean;
}
const empty = {
  payment_method: "upi" as Method,
  provider_key: "razorpay" as Provider,
  display_name: "",
  merchant_reference: "",
  environment: "test" as "test" | "live",
  priority: "100",
  min_amount: "1",
  max_amount: "100000",
  upi_vpa: "",
  dynamic_qr_supported: false,
};
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(marketError(error));
  return data as T;
}

/** Admin-only registry for supported card and UPI merchant accounts. */
export function PaymentAccounts() {
  const [rows, setRows] = useState<PaymentAccount[] | null>(null);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setRows(await rpc<PaymentAccount[]>("admin_list_payment_accounts"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load payment accounts.");
    }
  }, []);
  const { busy, run, messages } = useAction(reload);
  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(
      () =>
        rpc<string>("admin_upsert_payment_account", {
          p_id: editingId,
          p_payment_method: form.payment_method,
          p_provider_key: form.provider_key,
          p_display_name: form.display_name.trim(),
          p_merchant_reference: form.merchant_reference.trim(),
          p_environment: form.environment,
          p_priority: Number(form.priority),
          p_min_amount_paise: Math.round(Number(form.min_amount) * 100),
          p_max_amount_paise: Math.round(Number(form.max_amount) * 100),
          p_upi_vpa: form.payment_method === "upi" ? form.upi_vpa.trim() : null,
          p_dynamic_qr_supported: form.payment_method === "upi" && form.dynamic_qr_supported,
        }),
      "Payment account metadata saved. Connect and test provider credentials before activation.",
    );
    setForm(empty);
    setEditingId(null);
  };

  const edit = (a: PaymentAccount) => {
    setEditingId(a.id);
    setForm({
      payment_method: a.payment_method,
      provider_key: a.provider_key,
      display_name: a.display_name,
      merchant_reference: a.merchant_reference,
      environment: a.environment,
      priority: String(a.priority),
      min_amount: (a.min_amount_paise / 100).toFixed(2),
      max_amount: (a.max_amount_paise / 100).toFixed(2),
      upi_vpa: a.upi_vpa ?? "",
      dynamic_qr_supported: a.dynamic_qr_supported,
    });
  };

  const updateStatus = (id: string, status: "paused" | "disabled") =>
    void run(
      () => rpc("admin_set_payment_account_status", { p_id: id, p_status: status }),
      status === "paused" ? "Account paused for new checkouts." : "Account disabled for new checkouts.",
    );

  return (
    <section className="studio-section">
      <div className="panel">
        <h3>Payment accounts</h3>
        <p className="muted small">
          Configure multiple supported card gateway and UPI merchant accounts. New entries remain drafts until
          credentials are securely connected and provider tests pass.
        </p>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {!rows && !error && <div className="spinner" aria-hidden="true" />}
        {rows && rows.length === 0 && <p className="muted">No payment accounts configured.</p>}
        <ul className="admin-list">
          {rows?.map((a) => (
            <li key={a.id}>
              <div className="row between">
                <strong>{a.display_name}</strong>
                <span className="pill">{a.status}</span>
              </div>
              <p className="small muted">
                {a.payment_method.toUpperCase()} · {a.provider_key} · {a.environment.toUpperCase()} · Priority{" "}
                {a.priority}
              </p>
              <p className="small">
                {a.merchant_reference}
                {a.upi_vpa ? ` · ${a.upi_vpa}` : ""}
              </p>
              <p className="small muted">
                Limits: ₹{(a.min_amount_paise / 100).toFixed(2)}–₹{(a.max_amount_paise / 100).toFixed(2)} ·
                Dynamic QR: {a.dynamic_qr_supported ? "provider capability declared" : "not configured"} ·
                Credentials: {a.secret_configured ? "secret reference present" : "not connected"}
              </p>
              {a.last_tested_at && (
                <p className="small muted">
                  Last test: {a.last_test_status ?? "unknown"} · {new Date(a.last_tested_at).toLocaleString()}
                </p>
              )}
              <div className="row-wrap">
                <button className="btn small" disabled={busy} onClick={() => edit(a)}>
                  Edit
                </button>
                <button
                  className="btn small"
                  disabled={busy || a.status === "paused" || a.status === "disabled"}
                  onClick={() => updateStatus(a.id, "paused")}
                >
                  Pause
                </button>
                <button
                  className="btn small danger"
                  disabled={busy || a.status === "disabled"}
                  onClick={() => updateStatus(a.id, "disabled")}
                >
                  Disable
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <form className="panel form" onSubmit={(e) => void save(e)}>
        <h3>{editingId ? "Edit payment account" : "Add payment account"}</h3>
        <label className="field">
          <span>Payment method</span>
          <select
            value={form.payment_method}
            onChange={(e) =>
              setForm({
                ...form,
                payment_method: e.target.value as Method,
                provider_key: e.target.value === "card" ? "razorpay" : "razorpay",
              })
            }
          >
            <option value="upi">UPI</option>
            <option value="card">Card gateway</option>
          </select>
        </label>
        <label className="field">
          <span>Supported provider adapter</span>
          <select
            value={form.provider_key}
            onChange={(e) => setForm({ ...form, provider_key: e.target.value as Provider })}
          >
            {(form.payment_method === "card"
              ? ["razorpay", "cashfree", "payu"]
              : ["razorpay", "cashfree", "upi_psp"]
            ).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Display name</span>
          <input
            required
            minLength={2}
            maxLength={80}
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            placeholder="Main UPI account"
          />
        </label>
        <label className="field">
          <span>Merchant/account reference (no secret)</span>
          <input
            required
            minLength={2}
            maxLength={120}
            value={form.merchant_reference}
            onChange={(e) => setForm({ ...form, merchant_reference: e.target.value })}
            placeholder="Merchant ID or internal account label"
          />
        </label>
        {form.payment_method === "upi" && (
          <label className="field">
            <span>Company UPI ID / VPA</span>
            <input
              required
              value={form.upi_vpa}
              onChange={(e) => setForm({ ...form, upi_vpa: e.target.value })}
              placeholder="business@bank"
            />
          </label>
        )}
        <div className="row-wrap">
          <label className="field">
            <span>Environment</span>
            <select
              value={form.environment}
              onChange={(e) => setForm({ ...form, environment: e.target.value as "test" | "live" })}
            >
              <option value="test">Test</option>
              <option value="live">Live (still draft)</option>
            </select>
          </label>
          <label className="field">
            <span>Routing priority</span>
            <input
              type="number"
              min="1"
              max="10000"
              required
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            />
          </label>
        </div>
        <div className="row-wrap">
          <label className="field">
            <span>Minimum amount (INR)</span>
            <input
              type="number"
              min="1"
              step="0.01"
              required
              value={form.min_amount}
              onChange={(e) => setForm({ ...form, min_amount: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Maximum amount (INR)</span>
            <input
              type="number"
              min="1"
              step="0.01"
              required
              value={form.max_amount}
              onChange={(e) => setForm({ ...form, max_amount: e.target.value })}
            />
          </label>
        </div>
        {form.payment_method === "upi" && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.dynamic_qr_supported}
              onChange={(e) => setForm({ ...form, dynamic_qr_supported: e.target.checked })}
            />
            <span>
              Provider supports order-specific dynamic UPI QR (capability declaration only; provider
              verification still required)
            </span>
          </label>
        )}
        <p className="alert info small">
          This first registry screen stores account metadata only. It does not collect API secrets, activate
          payments, generate QR codes or credit tokens. Secure credential onboarding and provider connectivity
          tests are the next adapter layer.
        </p>
        {messages}
        <div className="row-wrap">
          <button className="btn dark" disabled={busy}>
            Save {editingId ? "changes" : "draft account"}
          </button>
          {editingId && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setEditingId(null);
                setForm(empty);
              }}
            >
              Cancel edit
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
