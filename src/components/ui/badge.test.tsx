import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders an inline <span> so it can sit inside a <p> without a DOM-nesting warning", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getByText } = render(
      <p>
        <Badge variant="neutral">Educational, not advice</Badge> text
      </p>,
    );
    expect(getByText("Educational, not advice").tagName).toBe("SPAN");
    const nesting = err.mock.calls.filter((c) => String(c[0]).includes("validateDOMNesting"));
    expect(nesting).toHaveLength(0);
  });
});
