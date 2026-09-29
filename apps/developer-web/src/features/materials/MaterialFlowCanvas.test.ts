import { describe, expect, it } from "vitest";
import { isMaterialSiteSelected } from "./MaterialFlowCanvas";

describe("isMaterialSiteSelected", () => {
  it("does not select every empty site when no material is selected", () => {
    expect(isMaterialSiteSelected("site-a", undefined, undefined, undefined)).toBe(false);
  });

  it("selects an occupied site by its material or site identity", () => {
    expect(isMaterialSiteSelected("site-a", "material-a", "material-a", undefined)).toBe(true);
    expect(isMaterialSiteSelected("site-a", "material-a", undefined, "site-a")).toBe(true);
    expect(isMaterialSiteSelected("site-a", "material-a", "material-b", "site-b")).toBe(false);
  });
});
