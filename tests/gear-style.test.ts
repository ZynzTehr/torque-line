import { describe, expect, it } from "vitest";
import { GEAR_BOOT_SCRIPT } from "@/components/shell/GearStyleSwitcher";

/** Runs the boot script the way the browser does, against a fake document and storage. */
function boot(saved: string | null) {
  const attrs: Record<string, string> = {};
  const document = { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } };
  const localStorage = { getItem: () => saved };
  new Function("document", "localStorage", GEAR_BOOT_SCRIPT)(document, localStorage);
  return attrs["data-gear-style"];
}

describe("gear style boot script", () => {
  it("applies a saved finish before paint", () => {
    expect(boot("amber")).toBe("amber");
    expect(boot("stealth")).toBe("stealth");
  });
  it("ignores missing or unknown values, leaving the default cyan", () => {
    expect(boot(null)).toBeUndefined();
    expect(boot("pink")).toBeUndefined();
  });
});
