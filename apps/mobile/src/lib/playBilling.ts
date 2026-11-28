/**
 * Thin wrapper over expo-iap (Google Play Billing Library). Purchases are always sent to the RentMate API for
 * verification; this module never grants anything and never consumes or acknowledges purchases itself: the server
 * does that only after it has recorded the purchase, so an unverified purchase is refunded by Google after 3 days.
 */
import {
  endConnection,
  ErrorCode,
  fetchProducts,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Purchase,
} from "expo-iap";
import { playAccountId, type StoreKind } from "./billing";

export type StorePrice = { productId: string; displayPrice: string; offerToken: string | null };

export type BillingEvents = {
  /** A purchase Google reports as completed: send it to the server. */
  onPurchased: (p: { productId: string; purchaseToken: string }) => void;
  /** A purchase waiting for payment (e.g. cash or delayed UPI): nothing is granted yet. */
  onPending: (productId: string) => void;
  onError: (message: string) => void;
};

let connected = false;

export async function connect(events: BillingEvents) {
  if (!connected) {
    await initConnection();
    connected = true;
  }
  const updated = purchaseUpdatedListener((p: Purchase) => {
    if (!p.purchaseToken) return;
    if (p.purchaseState === "pending") events.onPending(p.productId);
    else if (p.purchaseState === "purchased")
      events.onPurchased({ productId: p.productId, purchaseToken: p.purchaseToken });
  });
  const failed = purchaseErrorListener((e) => {
    if (e.code === ErrorCode.UserCancelled) return;
    events.onError(e.message || "The purchase could not be completed.");
  });
  return () => {
    updated.remove();
    failed.remove();
  };
}

export async function disconnect() {
  if (!connected) return;
  connected = false;
  await endConnection();
}

/** Localised prices from Google Play (the server's catalog decides token quantities). */
export async function prices(ids: { tokenPacks: string[]; subscriptions: string[] }): Promise<StorePrice[]> {
  const out: StorePrice[] = [];
  if (ids.tokenPacks.length) {
    const items = (await fetchProducts({ skus: ids.tokenPacks, type: "in-app" })) ?? [];
    for (const p of items as { id: string; displayPrice: string }[]) {
      out.push({ productId: p.id, displayPrice: p.displayPrice, offerToken: null });
    }
  }
  if (ids.subscriptions.length) {
    const items = (await fetchProducts({ skus: ids.subscriptions, type: "subs" })) ?? [];
    for (const p of items as {
      id: string;
      displayPrice: string;
      subscriptionOffers?: { displayPrice: string; offerTokenAndroid?: string | null }[] | null;
    }[]) {
      const offer = p.subscriptionOffers?.find((o) => o.offerTokenAndroid) ?? null;
      out.push({
        productId: p.id,
        displayPrice: offer?.displayPrice ?? p.displayPrice,
        offerToken: offer?.offerTokenAndroid ?? null,
      });
    }
  }
  return out;
}

/** Opens Google Play's purchase sheet, bound to the signed-in member. The result arrives through connect(). */
export async function buy(userId: string, kind: StoreKind, productId: string, offerToken: string | null) {
  const obfuscatedAccountId = playAccountId(userId);
  if (kind === "subscription") {
    if (!offerToken) throw new Error("This plan is not available in Google Play yet.");
    await requestPurchase({
      type: "subs",
      request: {
        google: {
          skus: [productId],
          obfuscatedAccountId,
          subscriptionOffers: [{ sku: productId, offerToken }],
        },
      },
    });
    return;
  }
  await requestPurchase({ type: "in-app", request: { google: { skus: [productId], obfuscatedAccountId } } });
}

/** Purchases Google still holds for this device (e.g. the app closed before the server answered). */
export async function unfinished(): Promise<{ productId: string; purchaseToken: string }[]> {
  const list = ((await getAvailablePurchases()) ?? []) as Purchase[];
  return list
    .filter((p) => p.purchaseState === "purchased" && p.purchaseToken)
    .map((p) => ({ productId: p.productId, purchaseToken: p.purchaseToken as string }));
}
