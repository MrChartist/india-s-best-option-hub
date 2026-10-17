import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Learn from "@/pages/Learn";
import LearnLesson from "@/pages/LearnLesson";
import { LESSONS } from "@/content/learn/lessons";
import { PROGRESS_STORAGE_KEY } from "@/content/learn/progress";
import MetricHelp from "./MetricHelp";

vi.mock("@/hooks/useMarketData", () => ({
  useLiveIndices: () => ({ data: { data: [], isLive: false, source: "none", asOf: Date.now(), stale: true }, isLoading: false, source: "none", asOf: Date.now(), stale: true }),
}));

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/learn" element={<Learn />} />
        <Route path="/learn/:slug" element={<LearnLesson />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Learn hub", () => {
  it("renders the NISMExams hero, paths, glossary and disclaimers", () => {
    renderAt("/learn");
    expect(screen.getByRole("heading", { level: 1, name: /learn options with nismexams\.com/i })).toBeInTheDocument();
    expect(document.title).toMatch(/Learn options with NISMExams\.com/);
    expect(screen.getByRole("heading", { name: "Options 101" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Glossary" })).toBeInTheDocument();
    expect(screen.getAllByText(/Not investment advice/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Educational content in partnership with NISMExams\.com/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Series VIII prep/i })[0]).toHaveAttribute("href", expect.stringMatching(/^https:\/\/nismexams\.com\/courses/));
    expect(screen.getByRole("link", { name: /Start with Options 101/i })).toHaveAttribute("href", `/learn/${LESSONS[0].slug}`);
  });

  it("filters lessons and the glossary", () => {
    renderAt("/learn");
    fireEvent.change(screen.getByLabelText("Filter lessons"), { target: { value: "gamma exposure" } });
    const paths = screen.getByRole("heading", { name: "Learning paths" }).closest("section") as HTMLElement;
    expect(within(paths).getByRole("link", { name: /Gamma exposure on NSE/i })).toBeInTheDocument();
    expect(within(paths).queryByRole("link", { name: /Calls and puts in plain English/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter lessons"), { target: { value: "zzzz" } });
    expect(within(paths).getByText(/No lessons match/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search the glossary"), { target: { value: "qwertyuiop" } });
    expect(screen.getByText(/No terms match/i)).toBeInTheDocument();
  });
});

describe("Lesson page", () => {
  it("shows a friendly not-found state", () => {
    renderAt("/learn/does-not-exist");
    expect(screen.getByRole("heading", { level: 1, name: /lesson not found/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to the learn hub/i })).toHaveAttribute("href", "/learn");
  });

  it("renders every lesson with its quiz and footer", () => {
    for (const l of LESSONS) {
      const { unmount } = renderAt(`/learn/${l.slug}`);
      expect(screen.getByRole("heading", { level: 1, name: l.title })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /check your understanding/i })).toBeInTheDocument();
      expect(screen.getByText(/Educational content in partnership with NISMExams\.com/i)).toBeInTheDocument();
      expect(document.title).toContain(l.title);
      unmount();
    }
  });

  it("loads the interactive simulator with a sample-data label", async () => {
    renderAt("/learn/implied-volatility");
    expect(await screen.findByRole("heading", { name: /IV and the straddle/i }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getAllByText(/Sample data/i).length).toBeGreaterThan(0);
    const slider = screen.getByRole("slider", { name: "Implied volatility" });
    act(() => {
      slider.focus();
      fireEvent.keyDown(slider, { key: "ArrowRight" });
    });
    expect(slider).toHaveAttribute("aria-valuenow", "13.5");
  });

  it("saves quiz results and completion to localStorage", () => {
    const lesson = LESSONS[0];
    renderAt(`/learn/${lesson.slug}`);
    const quiz = screen.getByRole("heading", { name: /check your understanding/i }).closest("section") as HTMLElement;
    const groups = within(quiz).getAllByRole("group");
    lesson.quiz.forEach((q, i) => {
      fireEvent.click(within(groups[i]).getByLabelText(q.options[q.answer]));
    });
    fireEvent.click(within(quiz).getByRole("button", { name: /check answers/i }));
    expect(within(quiz).getByText(new RegExp(`Passed: ${lesson.quiz.length}/${lesson.quiz.length}`))).toBeInTheDocument();
    const saved = JSON.parse(window.localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}");
    expect(saved.completed[lesson.slug]).toBeTruthy();
    expect(saved.quiz[lesson.slug].best).toBe(lesson.quiz.length);
    expect(saved.lastSlug).toBe(lesson.slug);
    expect(screen.getAllByText(/Completed/).length).toBeGreaterThan(0);
  });
});

describe("MetricHelp", () => {
  it("renders an accessible trigger and opens on click with a lesson link", async () => {
    render(
      <MemoryRouter>
        <MetricHelp metric="ivr" value={42.4}>
          IVR
        </MetricHelp>
      </MemoryRouter>,
    );
    const btn = screen.getByRole("button", { name: "What is IV Rank (IVR)?" });
    fireEvent.click(btn);
    expect(await screen.findByText(/Now: 42/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /learn more/i })).toHaveAttribute("href", "/learn/implied-volatility");
  });

  it("falls back to its children for an unknown metric and works outside a router", () => {
    const { container } = render(<MetricHelp metric="unknown-thing">Label</MetricHelp>);
    expect(container.textContent).toBe("Label");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    render(<MetricHelp metric="pcr" />);
    fireEvent.click(screen.getByRole("button", { name: /put-call ratio/i }));
    expect(screen.getByRole("link", { name: /learn more/i })).toHaveAttribute("href", "/learn/max-pain-pcr");
  });
});
