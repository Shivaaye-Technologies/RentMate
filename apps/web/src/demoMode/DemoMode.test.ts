import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoBanner, DemoMode, SIMULATED_NOTE } from "./DemoMode";

describe("Demo Mode screens", () => {
  it("always says everything is fictional and simulated", () => {
    const html = renderToStaticMarkup(
      createElement(DemoBanner, { signedIn: false, onExit: () => undefined, onReset: () => undefined }),
    );
    expect(html).toContain("Demo Mode");
    expect(html).toMatch(/fictional and simulated/);
    expect(html).toMatch(/Nothing is saved to real accounts or shown to real members/);
    expect(html).toContain("Exit demo");
  });

  it("offers members a way back to the real app", () => {
    const html = renderToStaticMarkup(
      createElement(DemoBanner, { signedIn: true, onExit: () => undefined, onReset: () => undefined }),
    );
    expect(html).toContain("Back to the app");
  });

  it("shows the banner while profiles load", () => {
    const html = renderToStaticMarkup(createElement(DemoMode, { signedIn: false, onExit: () => undefined }));
    expect(html).toMatch(/fictional and simulated/);
    expect(html).toContain("Loading fictional demo profiles");
  });

  it("labels simulated matches", () => {
    expect(SIMULATED_NOTE).toMatch(/^Simulated: demo profiles are fictional/);
  });
});
