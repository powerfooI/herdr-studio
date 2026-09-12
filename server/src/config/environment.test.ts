import { describe, expect, test } from "bun:test";
import { roamgateEnv } from "./environment";
import { isSupervisorManagedEnvironment } from "../http/update";

describe("Roamgate environment compatibility", () => {
  test("new names override legacy names without mutating the environment", () => {
    const environment = {
      ROAMGATE_PASSWORD: "new-secret",
      HERDR_GUI_PASSWORD: "old-secret",
    };
    expect(roamgateEnv("PASSWORD", environment)).toBe("new-secret");
    expect(environment.HERDR_GUI_PASSWORD).toBe("old-secret");
    expect(roamgateEnv("PASSWORD", { HERDR_GUI_PASSWORD: "old-secret" })).toBe(
      "old-secret",
    );
    expect(
      roamgateEnv("PASSWORD", {
        ROAMGATE_PASSWORD: "",
        HERDR_GUI_PASSWORD: "old-secret",
      }),
    ).toBe("");
    expect(roamgateEnv("PASSWORD", {})).toBeUndefined();
  });

  test("new supervisor override takes precedence over legacy settings and detection", () => {
    expect(
      isSupervisorManagedEnvironment({
        ROAMGATE_RESTART_SUPERVISOR: "0",
        HERDR_GUI_RESTART_SUPERVISOR: "1",
        INVOCATION_ID: "service",
      }),
    ).toBe(false);
    expect(
      isSupervisorManagedEnvironment({
        ROAMGATE_RESTART_SUPERVISOR: "1",
        HERDR_GUI_RESTART_SUPERVISOR: "0",
      }),
    ).toBe(true);
  });
});
