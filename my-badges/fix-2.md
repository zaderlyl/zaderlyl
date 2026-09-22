<img src="https://my-badges.github.io/my-badges/fix-2.png" alt="I did 2 sequential fixes." title="I did 2 sequential fixes." width="128">
<strong>I did 2 sequential fixes.</strong>
<br><br>

Commits:

- <a href="https://github.com/zaderlyl/phaser-ui-editor/commit/098b432cdbb666117737438da42f05baa31fce8a">098b432</a>: fix(groups): stop exponential scale compounding on group resize

resizeSelected() multiplied a relative scale factor onto the
GameObject's live scaleX/Y each time `drag` fired (every pointer
move, not once per drag), causing the group's scale to compound
exponentially and the fixed corner to drift instead of staying put.

Capture startScaleX/startScaleY once in the resize snapshot at
dragstart, and always recompute scale as (newSize / startSize) *
startScale relative to that fixed reference — matching the
absolute-recomputation pattern already used for position/size.
- <a href="https://github.com/zaderlyl/phaser-ui-editor/commit/5ff9e398b66dccba69cb37b8bcd381ac045feb8f">5ff9e39</a>: Fix resize handles being too easy to miss on a group

Root cause found by testing: a resize handle's hit area was exactly
its 10x10 visual size, with no margin. Missing it by just a few
pixels (very easy at normal cursor precision, worse on a CSS-scaled-
down canvas) hit whichever child element was underneath instead —
for a grouped element specifically, that gets misread as 'move the
group' (the click-redirect logic from the previous commit), which
looks exactly like what was reported: dragging what looked like the
resize handle just shifted the group's position instead of resizing
it.

- Each handle now gets an explicit hitArea 8px larger on every side
  than its visual square (still using Phaser's default handle
  behavior otherwise — same corner, same drag logic), via the
  setInteractive({ hitArea, hitAreaCallback }) config form, which
  also required moving useHandCursor into that same config object

Verified precisely: dispatched a click at the exact pixel offset (8px
inside the corner) that previously and reliably grabbed the child
underneath — it now hits the handle instead, and a full drag from
that same point correctly resizes the group. Tested at both native
and CSS-scaled-down canvas sizes.


Created by <a href="https://github.com/my-badges/my-badges">My Badges</a>