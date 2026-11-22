# MayLo design system

Captured read-only from the app sources. Values below exist in those files; nothing is invented.

## Colors (light)

Source: `src/constants/theme.ts` (`Colors.light`)

| Token | Value | Usage |
| --- | --- | --- |
| `text` | `#1F1A17` | Primary text |
| `textSecondary` | `#6B6058` | Muted text, inactive tab icons, subtitles |
| `background` | `#FFF9F4` | Screen and header background |
| `backgroundElement` | `#F6EEE6` | Cards, fields |
| `backgroundSelected` | `#ECE1D6` | Secondary buttons, selected rows, borders |
| `accent` | `#F26B3A` | Primary button fill, icons in section titles |
| `onAccent` | `#2B1206` | Text on accent fills |
| `accentText` | `#A23D14` | Accent-colored text and header actions |
| `accentSoft` | `#FFE3D3` | Soft accent surfaces |
| `success` | `#4E9F3D` | Done / paid fills |
| `onSuccess` | `#FFFFFF` | Icons on success fill |
| `successText` | `#2F6B22` | Success text |
| `successSoft` | `#E3F2DC` | Checked card background |
| `danger` | `#D64545` | Destructive button fill (white text) |
| `sunsetTop` | `#FFB25B` | Brand gradient top |
| `sunsetBottom` | `#F26B3A` | Brand gradient bottom |

## Colors (dark)

Source: `src/constants/theme.ts` (`Colors.dark`)

| Token | Value | Usage |
| --- | --- | --- |
| `text` | `#F7F1EC` | Primary text |
| `textSecondary` | `#B9ACA2` | Muted text |
| `background` | `#15110F` | Screen background |
| `backgroundElement` | `#221C18` | Cards, fields |
| `backgroundSelected` | `#2F2621` | Secondary buttons, selected rows |
| `accent` | `#FF8A57` | Primary fill |
| `onAccent` | `#2B1206` | Text on accent |
| `accentText` | `#FF9E72` | Accent text |
| `accentSoft` | `#3A2216` | Soft accent surface |
| `success` | `#6CC24A` | Success fill |
| `successText` | `#8FD86F` | Success text |
| `successSoft` | `#1E2C18` | Checked card background |
| `danger` | `#FF6B6B` | Destructive fill |

Note: `src/lib/palette.ts` swaps accent and success for the second member ("her palette").

## Typography

Source: `src/global.css`, `src/components/ui.tsx`

| Token | Value | Usage |
| --- | --- | --- |
| `--font-display` | `Spline Sans, Inter, ui-sans-serif, system-ui, sans-serif` | Web display stack; native uses the platform default |
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` | Logs, code |
| Section title | `18px / 700` | `SectionTitle`, margin-top 16 |
| Row title | `16px / 600` | `CheckRow` title |
| Button label | `15px / 600` | `Button` |
| Field text | `16px` | `Field` |
| Subtitle | `13px` | `CheckRow` subtitle |

## Spacing

Source: `src/constants/theme.ts` (`Spacing`)

| Token | Value |
| --- | --- |
| `half` | `2px` |
| `one` | `4px` |
| `two` | `8px` |
| `three` | `16px` |
| `four` | `24px` |
| `five` | `32px` |
| `six` | `64px` |

Screen: padding 16, gap 8, bottom padding 64, max width 800 (`src/components/screen.tsx`).

## Radius

Source: `src/components/ui.tsx`

| Token | Value | Usage |
| --- | --- | --- |
| Button / Field | `10px` | `Button`, `Field` |
| Card | `12px` | `CheckRow` card |
| Checkbox | `6px` | `CheckRow` box |

## Shadows

None defined; surfaces separate by background tone, not elevation.

## Components

Source: `src/components/ui.tsx`, `src/components/icon.tsx`

- **Button**: padding 10×16, radius 10, centered 15/600 label. `primary` = accent fill + onAccent text; `secondary` = backgroundSelected + text; `danger` = danger + white. Disabled = 50% opacity; pressed = 80%.
- **Field**: backgroundElement, radius 10, padding 10×16, 16px text, placeholder in textSecondary.
- **CheckRow**: card radius 12, padding 16; 24px checkbox (success when checked), title 16/600, subtitle 13.
- **SectionTitle**: 18/700, optional 20px accent icon.
- **Muted**: textSecondary body text.
- **Icon**: 24px grid line icons, stroke 2, round caps; no emoji in the UI.
- **Header**: background color, no shadow, accentText actions.
