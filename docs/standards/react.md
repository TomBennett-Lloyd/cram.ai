# React standards

_Ported from [cumulo](https://github.com/TomBennett-Lloyd/cumulo) on 2026-10-13. Citations of the form `cumulo#<n>` are the issues and PRs where each rule was earned there; this repo's own evidence accrues under bare `#<n>`._

**Trigger:** writing or modifying a React component, hook, or anything involving `useEffect`.

## Rules

1. **Effects synchronize with external systems — nothing else.** Subscriptions, imperative third-party widget APIs, timers. Not derived state (compute it during render), not responding to user actions (that's an event handler), not "run this when X changes" choreography (restructure so the data flows down).

2. **`react-hooks/exhaustive-deps` is an error, and the dependency array is never the knob.** If honest dependencies cause an infinite loop or unwanted re-runs, the _structure_ is wrong. The fixes, in order of preference:
   - Derived value? Compute during render; `useMemo` only if measured as expensive.
   - Responding to an interaction? Move the logic into the event handler.
   - Need the latest value inside an effect/callback _without_ re-triggering it? Store it in a ref, updated on render:

     ```ts
     const onSettledRef = useRef(onSettled);
     onSettledRef.current = onSettled;
     useEffect(() => {
       const sub = stream.subscribe((v) => onSettledRef.current(v));
       return () => sub.unsubscribe();
     }, [stream]); // honest deps — callback changes don't resubscribe
     ```

   - Unstable object/function dep? Stabilize it at its source (`useCallback`/`useMemo` there, or move it out of the component), don't omit it here.

3. **Colocate state; lift it only when two components genuinely share it.** Server data is not component state — it belongs to the data-fetching layer, with loading/error modes encoded as a discriminated union (see `typing.md` rule 4).

4. **Components are presentational by default.** Data fetching and domain logic live in hooks/modules; a component that's hard to render in isolation (Storybook-style) is structured wrong.

5. **Design tokens only — lint-enforced, not a convention.** `eslint.config.mjs` and `stylelint.config.mjs` are the rule; read them for the exact scope rather than trusting a paraphrase here. Both run under `pnpm lint`, and disable comments are themselves errors in both linters. So: if a token is missing, the lint error _is_ the design signal — raise it as a design-system issue rather than reaching for a literal.

## Async surface convention (apps/web)

Every surface that waits on data says so the same way. The three states are implemented once, as shared pending, empty and error components, and the app's async-state and failure wording lives in one copy module — reach for those rather than writing another spelling of "loading…". A contract test sweeps the app for phrase classes that drift back inline, so an inlined pending label or failure sentence fails a gate, not just a review.

- **Pending** is a visible label inside an `aria-busy="true"` container — never a live region mounted with its text already in it. A `role="status"` that exists only while it is full has no change to report, so it announces nothing and merely looks accessible (cumulo#161).

  **A surface that _is_ a drawing may carry its pending state as a drawing inside the `aria-busy` container, and then owes no visible label** (amended in cumulo by the owner, cumulo#448, after a chart's pending label was ruled both misleading and a cause of the page jumping). The **visible label** clause is what gave way; the property it was protecting did not. That property is the whole of what the bullet asks — the busy state is machine-readable, and no live region mounts with text already in it. `aria-busy` is not optional, so a wordless pending state is silent to eyes and not to a screen reader; and a drawing is not a licence to announce instead, because a `role="status"` mounted full announces nothing however the surface is styled. The exception is narrow on purpose: the test is whether the surface's _content_ is a drawing rather than whether it happens to contain one. A panel of prose that grows a spinner has not earned it — the reader is waiting for words, so the wait is owed words.

- **Failed** is `role="alert"` with a message in the panel's own words, plus a retry **only when retrying can work**. These components mount into a tree that is already on screen, so the alert really is a change and really is announced. A retry that re-runs an identical metered request is not a recourse — omit it and let the reader's own controls be the retry.
- **Empty** is plain content, no live semantics, stating the next action where there is one. An empty list is a successful answer, not an event.
- **At most one live region per panel, with exactly one sanctioned co-occurrence.** Announcements compete; two regions in one panel means the reader hears whichever won. In a panel showing a chart, the budget is spent on the chart's own readout — mounted empty with the chart and filled only when a reader moves the selection. The one exception is the **failed** state, where a second `role="alert"` may mount beside that readout, because the two provably cannot compete: a failed read leaves the chart no points, so the readout has no sample to render and stays empty for exactly as long as the alert is up (cumulo#284 D3, cumulo#452). It is a co-occurrence, not a second budget — the literal count gave way, and the property it protected (a reader is never made to arbitrate between two things talking at once) did not.
- **Completion is not announced.** The arrival of data is the busy container being replaced by the content — that is the signal, and adding a "loaded" announcement on top of it says the same thing twice.
- **A live region never renders inside a `hidden`/`display: none` subtree** — it was never on screen, so the later reveal is an attribute change rather than a DOM change and assistive technology reports nothing at either moment (cumulo#161). A panel that can be hidden therefore renders its states only once it is revealed.
- **A message mounted in response to something the reader did is `role="alert"`** — a form's refusal arrives because a button was pressed, so it really is a change to a tree already on screen.
- **First paint mounts no live region carrying text** — pending is `aria-busy` and alerts arrive only as changes, pinned by a test. An announcement reaches a reader only by _arriving_, as a change to a region that was already there, so a region mounted with its text already inside it announces nothing and merely looks accessible (cumulo#161). An **empty** region at first paint is the opposite case — it is the container a later change needs in order to be a change, and it says nothing on the way in. A region that mounts _with_ text in it fails this rule, and that is the whole of what it asks.
- **An unhandled promise rejection lands at the app's error boundary**, which gives the rejection nobody awaited the same labelled failure a render throw gets rather than a silent hang.

**Whether a selection is the reader's is a fact worth carrying, even though no selection moves focus.** A surface that opens because somebody pressed something is a change they asked for — a press, a search hit and a creation all qualify, and so does whatever opener is added next, because the test is that the page changed in answer to an action. A surface that opens because the URL said so asked nobody: on a deep link it can mount seconds in, so anything that surface does to the focus is done to somebody who did nothing to ask for it (WCAG 3.2.5; cumulo#260). Carry the distinction beside the selection itself rather than letting each surface guess.

**Where the focus lands on a selection is nowhere.** cumulo#328 settled it on the rule that a page which grabs the focus takes the reader's place away to tell them something it could have told them where they stood (`design.md` rule 11). A selection's answer is announced by its own structure, and the reader is left where they put themselves. Combobox discipline is the sharpest case: picking a value keeps the focus in the input, so a landing elsewhere takes the reader out of a field they were still typing in. The one exception is a **modal**, which keeps its heading landing — its own controls _are_ the answer, everything the reader came for is inside it, and while it is up there is nothing behind it to be left standing on.

**A surface that leaves owes a landing, and it owes it to whoever it took the focus from.** A non-modal surface captures `document.activeElement` as it opens and restores it on unmount, so a reader who came into it and pressed Close lands back on whatever opened it, without the parent knowing which opener it was. Capture inside the mount effect, after React has flushed the commit's unmount cleanups, so the captured opener is wherever the previous surface put the focus rather than an element that has already left the document. An opener no longer in the document is not chased.

**A surface that never took the focus returns none.** That is one clause of the rule above, not a second rule: the restore is guarded on the surface still holding the focus it would be giving back. With nothing landing a reader inside it, the surface usually holds nothing, so a dismissal from outside it leaves the reader exactly where they already were. The guard is the thing to preserve, rather than the count of paths that reach it.

**A modal owes its own landing, because the platform stops paying it.** A `<dialog>` that closes by being unmounted never runs the close steps, so the browser's usual focus restoration never happens. Return focus from the dialog's effect cleanup rather than its `cancel` handler: on the Escape path the browser is still restoring focus while `cancel` is dispatched, and would overwrite a focus set there.

jsdom tests hold all of this as far as `document.activeElement` goes. The ring a reader actually sees is a judgement about _how_ the focus arrived — the browser's own heuristic normally, and the element's focus-source guard where that heuristic gets a pointer focus wrong — so it is the browser lane's either way (`testing.md` rule 10), and there it is two specs holding one clause each: one keeps the ring a keyboard reader depends on; the other keeps the clause that no ring appears where the reader did not ask for one, over both pointer flows — mouse **and touch**, named as two arms. Naming touch rather than writing "pointer" is the point: "pointer" is the word that let a touch path go unmeasured in cumulo#440 while a tapped chart took a ring the mouse path never took. Neither spec is meaningful alone, since each one's assertions are satisfied by an app that fails the other's, so a change deleting either is deleting half a rule.

## Why

The effect-dependency hack is the canonical example of suppressing a symptom instead of fixing a cause: the lint rule is reporting a data-flow problem, and deleting the dependency converts a visible loop into a subtle stale-closure bug. The same root-cause principle applies to the whole component layer.
