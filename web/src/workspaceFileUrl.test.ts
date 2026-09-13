import { describe, expect, test } from "bun:test";
import {
  resolveWorkspaceMarkdownImagePath,
  resolveWorkspaceMarkdownImageUrl,
  workspaceFileUrl,
  workspaceMarkdownDocumentPath,
} from "./workspaceFileUrl";

const client = {
  connectionId: "remote dev",
  serverRuntimeGeneration: 7,
};

describe("workspace file URLs", () => {
  test("builds generation-bound inline resource URLs", () => {
    expect(workspaceFileUrl(client, "workspace 1", "docs/a b.pdf")).toBe(
      "/api/connections/remote%20dev/file/download?connection_generation=7&workspace_id=workspace+1&path=docs%2Fa+b.pdf",
    );
    expect(
      workspaceFileUrl(client, "workspace 1", "docs/a b.pdf", {
        inline: true,
        revision: 3,
      }),
    ).toEndWith("&inline=1&resource_revision=3");
  });

  test("resolves Markdown images relative to the document", () => {
    expect(
      resolveWorkspaceMarkdownImagePath(
        "../assets/demo%20image.png",
        "docs/guide/readme.md",
      ),
    ).toBe("docs/assets/demo image.png");
    expect(
      resolveWorkspaceMarkdownImagePath("/assets/logo.png", "docs/readme.md"),
    ).toBe("assets/logo.png");
    expect(
      resolveWorkspaceMarkdownImagePath(
        "../../../secret.png",
        "docs/readme.md",
      ),
    ).toBeNull();
  });

  test("keeps remote images and maps local images to the workspace endpoint", () => {
    expect(
      resolveWorkspaceMarkdownImageUrl(
        "https://example.com/image.png",
        "README.md",
        client,
        "w1",
      ),
    ).toBe("https://example.com/image.png");
    expect(
      resolveWorkspaceMarkdownImageUrl(
        "images/screenshot.png",
        "docs/README.md",
        client,
        "w1",
        4,
      ),
    ).toContain(
      "path=docs%2Fimages%2Fscreenshot.png&inline=1&resource_revision=4",
    );
  });
});

import { resolveWorkspaceMarkdownLink } from "./workspaceFileUrl";

describe("Markdown document links", () => {
  test("normalizes absolute in-workspace bases before resolving links", () => {
    for (const path of ["README.md", "/repo/README.md"]) {
      const base = workspaceMarkdownDocumentPath(path, "/repo");
      expect(resolveWorkspaceMarkdownLink("../etc/passwd", base)).toBeNull();
      expect(resolveWorkspaceMarkdownLink("guide.md#section", base)).toEqual({
        path: "guide.md",
        fragment: "section",
      });
      expect(resolveWorkspaceMarkdownLink("/docs/a.md#root", base)).toEqual({
        path: "docs/a.md",
        fragment: "root",
      });
      expect(resolveWorkspaceMarkdownLink("#intro", base)).toEqual({
        path: "README.md",
        fragment: "intro",
      });
    }
    expect(workspaceMarkdownDocumentPath("/repo/docs/a.md", "/repo/")).toBe(
      "docs/a.md",
    );
    expect(workspaceMarkdownDocumentPath("/docs/a.md", "/")).toBe("docs/a.md");
  });

  test("preserves relative siblings for intentionally external previews", () => {
    for (const path of ["/outside/README.md", "/repo-other/README.md"]) {
      const base = workspaceMarkdownDocumentPath(path, "/repo");
      expect(base).toBe(path);
      expect(resolveWorkspaceMarkdownLink("./alias.md#section", base)).toEqual({
        path: path.replace("README.md", "alias.md"),
        fragment: "section",
      });
      expect(resolveWorkspaceMarkdownLink("/README.md", base)).toEqual({
        path: "README.md",
        fragment: "",
      });
    }
  });

  test("resolves siblings, parent directories, and workspace-root links", () => {
    expect(
      resolveWorkspaceMarkdownLink("./setup.md", "docs/guide/README.md"),
    ).toEqual({ path: "docs/guide/setup.md", fragment: "" });
    expect(
      resolveWorkspaceMarkdownLink(
        "../API%20guide.md?view=1#api%20reference",
        "docs/guide/README.md",
      ),
    ).toEqual({ path: "docs/API guide.md", fragment: "api reference" });
    expect(
      resolveWorkspaceMarkdownLink("/README.md#intro", "docs/guide.md"),
    ).toEqual({ path: "README.md", fragment: "intro" });
    expect(resolveWorkspaceMarkdownLink("#install", "docs/guide.md")).toEqual({
      path: "docs/guide.md",
      fragment: "install",
    });
    expect(
      resolveWorkspaceMarkdownLink("..\\README.md", "docs/guide.md"),
    ).toEqual({ path: "README.md", fragment: "" });
  });

  test("leaves external URLs alone and rejects invalid workspace paths", () => {
    for (const source of [
      "https://example.com/guide.md",
      "mailto:help@example.com",
      "//example.com/guide.md",
      "javascript:alert(1)",
    ]) {
      expect(
        resolveWorkspaceMarkdownLink(source, "docs/README.md"),
      ).toBeUndefined();
    }
    for (const source of [
      "../../private.md",
      "%2e%2e/%2e%2e/private.md",
      "bad%00.md",
      "bad%ZZ.md",
    ]) {
      expect(resolveWorkspaceMarkdownLink(source, "docs/README.md")).toBeNull();
    }
    expect(
      resolveWorkspaceMarkdownLink("guide.md#bad%ZZ", "docs/README.md"),
    ).toEqual({ path: "docs/guide.md", fragment: "bad%ZZ" });
  });
});
