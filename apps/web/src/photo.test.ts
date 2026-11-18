import { describe, expect, it } from "vitest";
import { movePhoto, photoColumns, photoFileProblem } from "./photo";

describe("photo management", () => {
  it("checks the file before processing", () => {
    expect(photoFileProblem({ type: "application/pdf", size: 10 })).toMatch(/image/);
    expect(photoFileProblem({ type: "image/jpeg", size: 30 * 1024 * 1024 })).toMatch(/25 MB/);
    expect(photoFileProblem({ type: "image/png", size: 1000 })).toBeNull();
  });

  it("reorders photos", () => {
    expect(movePhoto(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(movePhoto(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(movePhoto(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("saves the first photo as the main one, at most 6, no duplicates", () => {
    expect(photoColumns(["b", "a", "b"])).toEqual({ photo_path: "b", photos: ["b", "a"] });
    expect(photoColumns([])).toEqual({ photo_path: null, photos: [] });
    expect(photoColumns(["1", "2", "3", "4", "5", "6", "7"]).photos).toHaveLength(6);
  });
});
