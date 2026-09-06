import { expect, test } from "bun:test";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

test("FitAddon does not reserve a gutter for xterm's hidden scrollbar", () => {
  const term = new Terminal({
    allowProposedApi: true,
    scrollback: 2000,
    scrollbar: { showScrollbar: false },
  });
  const parentElement = {};
  const element = {
    parentElement,
    ownerDocument: {
      defaultView: {
        getComputedStyle(target: unknown) {
          return {
            getPropertyValue(property: string) {
              if (target !== parentElement) return "0px";
              return property === "width" ? "1005px" : "500px";
            },
          };
        },
      },
    },
  };
  Object.assign(parentElement, { ownerDocument: element.ownerDocument });
  // Supply measured DOM geometry; use the installed xterm and addon together.
  Object.defineProperties(term, {
    element: { value: element },
    dimensions: { value: { css: { cell: { width: 10, height: 20 } } } },
  });
  const fit = new FitAddon();
  try {
    term.loadAddon(fit);
    expect(fit.proposeDimensions()).toEqual({ cols: 100, rows: 25 });
    fit.fit();
    expect(term.cols).toBe(100);
    expect(term.rows).toBe(25);
    term.options.scrollbar = { showScrollbar: true, width: 14 };
    expect(fit.proposeDimensions()).toEqual({ cols: 99, rows: 25 });
  } finally {
    term.dispose();
  }
});
