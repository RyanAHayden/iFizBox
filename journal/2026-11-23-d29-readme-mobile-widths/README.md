# D29: README crops on mobile

On GitHub mobile the README's right-floated screenshots left a sliver of text beside them. On a ~360px screen the
five floats were 300px wide, so the text column was about 40px and broke words mid-word ("Ope n", "Safa ri"). The
account crop, set at a fixed 280px, was nearly full width inside its list item.

## What was done

- `README.md`: the five right-floated crops (crop-web-certificate, crop-jb-sheet, crop-web-lite,
  crop-share-certificate, crop-signing-server) go from `width="300"` to `width="40%"`, still `align="right"`.
  The account crop (crop-account, inside a list item, not floated) goes from `width="280"` to `width="40%"`.
- GitHub strips CSS, so the width is an HTML attribute, and a percentage is what scales with the screen.
- The 30% hero row and the 24% screenshot rows were already fine at both widths, so they are unchanged.
- The account crop was tried at 35% first. That is about 114px on a 390px screen, too small beside the floats, so it
  matches them at 40%.
- `journal/2026-11-23-d29-readme-mobile-widths/`: this file and the before/after PNGs.

## How it was checked

- The README was rendered by GitHub's own markdown API (`gh api markdown -f mode=markdown -F text=@README.md`, the
  README-file mode; gfm mode adds hard line breaks). The HTML was wrapped in github-markdown-css 5.5.1 (light), with
  GitHub-like padding (16px under 768px, 45px and a 980px max width above), and images loaded through a file:// base
  href. Headless Chromium took the shots at 390px and 1000px wide.
- Install section at 390px, before and after: [install-390-before.png](install-390-before.png) and
  [install-390-after.png](install-390-after.png). Before, the text column was about 40px wide. After, it is a readable
  ~200px column beside a ~143px crop.
- Desktop at 1000px, before and after: [install-1000-before.png](install-1000-before.png) and
  [install-1000-after.png](install-1000-after.png). The crops go from 300px to about 356px in an 890px content column,
  and about 335px in GitHub's ~838px column on a wide screen.
- Account crop at 390px: [account-390-after.png](account-390-after.png), about 130px wide.

## Not verified

- github.com on a real phone. The page only shows after merge and publish. The render used GitHub's API HTML with
  github-markdown-css, not github.com's full page chrome, so the column widths are approximate.
- The `[!NOTE]` alert shows as raw text in the local render, because the markdown API does not render alerts. github.com
  does render them. This is a render artifact, not a README problem.
- The collapsed "More screenshots" rows (24%) were not expanded in the shots. They use the same 24% width as the
  visible rows.

## Seen, not changed

- The code block beside the jailbreak sheet float scrolls sideways at 390px. It is a `pre`, so it scrolls inside
  itself, and the page does not scroll.
- The "three builds" table is cramped at 390px.
