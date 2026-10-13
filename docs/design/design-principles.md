# Design principles

_Ported from [cumulo](https://github.com/TomBennett-Lloyd/cumulo) on 2026-10-13. Citations of the form `cumulo#<n>` are the issues and PRs where each rule was earned there; this repo's own evidence accrues under bare `#<n>`._

**This is a partial port.** cumulo's `docs/design/design-principles.md` was the distillation record
for cumulo#337: the evidence corpus, thirteen principles with the grounding behind each,
counterfactuals, a binding mechanism, and the owner's answers to its open questions. Almost all of
that grounding is specific to cumulo's map-and-chart dashboard, so only the general principles were
carried over — each restated without its dashboard-specific examples, with a one-line pointer to
where cumulo earned it. The counterfactuals, the binding mechanism, the mechanical-check
candidates and the per-ticket evidence were not ported; read them in cumulo if the history matters.

The operative copy of the rules is [`docs/standards/design.md`](../standards/design.md), which is
what agents read when the design trigger fires. Where this document and that file diverge, the
standards file wins.

## The principles

### P1 — Production bar, conventional grammar, every device

The app must read as a production application from an established business, on every widely-used
device: mobile is a first-class viewing context, never an adaptation afterthought. When a standard
idiom exists — header furniture, burger menu, About-in-menu, ARIA combobox, native
`<dialog>`/`<details>` — use it. Invented UI has to beat the convention, not tie it. Earned by
every correction that pulled an invented shape back to the standard one (cumulo#265, cumulo#284,
cumulo#326, cumulo#340).

### P2 — Chrome earns its place

Every visible piece of text or control must serve a reader decision the UI does not already serve.
Text that states what the page already shows does not ship. If a label's only real job is naming
something for assistive technology, it becomes an accessible name, not visible text. Genuine
explanation with no other home goes behind an (i) or About — and even an (i) goes when it
duplicates visible structure. Every copy-touching change asks: **"do we need this copy at all, or
could it be represented visually instead?"** There is no orientation carve-out: a feature that is
not self-evident is first a design smell to fix structurally. Boundaries: licence-mandated chrome
compacts to its sanctioned minimum and never disappears; state (notices, failure alerts) is not
description and stays inline. The most-repeated correction in cumulo's corpus (cumulo#323,
cumulo#329, cumulo#340, cumulo#344).

### P3 — The important content owns the viewport (prominence, not density)

The content the reader came for is the page; everything else folds, floats, or docks. New content
defaults to a folded or floating home — never a new always-open section, and never a boxed
container: a panel taxes its contents with spacing twice (edge-to-contents and
panel-to-surroundings), so the same content costs more room and the page reads more cluttered. The
goal is prominence and the removal of clutter, not density; whitespace that serves the content is
not the enemy. (cumulo#265, cumulo#284, cumulo#323.)

### P4 — Adjacency is information

Elements that form one reading unit touch; a visible gap or band between two elements says they
are unrelated. Decide which unit a new element belongs to and let the spacing say so. Not a density
mandate: the target is spacing that claims a separation nobody meant. (cumulo#323.)

### P5 — Missing data reads as missing

An absent value gets visible absence. Never elide it, bridge it, invent it (null → 0), or clamp it.
When an absence marker is ambiguous, fix the structure that makes it ambiguous — do not remove the
marker. cumulo learned the second sentence the expensive way: a marker deleted for being
unattributable was reinstated once the layout made it legible (cumulo#325, cumulo#330).

### P6 — Fixed reference frames: nothing shifts under the cursor

Interactive readouts keep stable geometry, so a moving cursor changes values, not layout. Position
may track the pointer continuously; content updates only at data cadence. The frame is stable in
time as well as space: geometry settles before first paint. (cumulo#284, cumulo#330, cumulo#343.)

### P7 — Measure the container, never assume the viewport

Layout decisions derive from measured available space, not viewport breakpoints: measure the
container, divide by the slots, choose the largest format version whose measured requirement fits.
Because fit is proven from the container inward, a parent changing width never invalidates the
logic. A viewport breakpoint is the documented escalation, not the default. Controls have wrap
priority over auxiliary text. (cumulo#326, cumulo#327, cumulo#344.)

### P8 — Typographic weight follows importance, as a gradient

How secondary a piece of text is drives both its size and its contrast, together and gradually.
Size never comes from outside the type scale and never scales with its container; fit problems are
solved by thinning or format-switching (P7), not by shrinking below the scale. (cumulo#323.)

### P9 — One meaning, one treatment

Every distinct visual meaning gets a treatment distinguishable at a glance, and every treatment
maps to exactly one meaning. Before adding a mark, enumerate the marks it must be told apart from,
in both themes. A treatment already carrying a meaning is not available for a new job. This
governs meanings and treatments, never palette values, which the design tokens own. (cumulo#284,
cumulo#335.)

### P10 — Context is drawn, not written

When the reader needs context to interpret content, prefer a subtle graphical layer over a
sentence, label, or legend entry about it. Context layers are decoration to a11y: out of the tab
order, at most one phrase of accessible description. (cumulo#324, cumulo#335.)

P2 and P10 read as a tension and are not one: together they are the taste's signature — remove
words, add drawing; density of meaning, economy of ink.

### P11 — Calm focus: rings and moves only when they serve the reader

Focus stays where the reader put it unless the page changed in answer to their action and the
change is where their next act lives. Deep links and URL-driven state never move focus.
Pattern-conventional widgets keep their own focus discipline. A focus ring is painted only when it
informs the current interaction — keyboard navigation, or typing in a field; where an engine's
heuristic gets a pointer focus wrong, the element carries a focus-source guard
(`docs/standards/design.md` rule 11). A visible ring the reader didn't ask for is a defect signal.
(cumulo#260, cumulo#328, cumulo#339, cumulo#440.)

### P12 — Interaction performance is a demonstrated feature

Pointer-driven surfaces are engineered for smoothness as a design property: position updates via
transform at a throttled pointer rate, content updates at data cadence from precomputed rows, data
layers never re-render per pointer frame, and linked interactions work from data already held. The
claim is measured and where feasible asserted — a measurement printed is not a measurement
asserted. (cumulo#331, cumulo#324.)

### P13 — Motion is smooth, brief, and optional

State changes prefer a smooth transition over a jump cut where one is possible, bounded twice:
every transition respects `prefers-reduced-motion`, and no transition delays or blocks the
interaction it accompanies. (cumulo's owner, 2026-08-10.)
