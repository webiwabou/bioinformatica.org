import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-shadow" d="M12 16H4V8H12V16Z" fill="var(--icon-weak-base)" />
      <path data-slot="logo-logo-mark-o" d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M60 80H20V40H60V80Z" fill="var(--icon-base)" />
      <path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

// The wordmark: the brand set in type rather than a logotype, so what renders is
// exactly the name it spells. `textLength` pins the drawn width to the viewBox so
// the mark keeps its box whatever sans-serif the host resolves.
// Kept in sync with the OAuth callback pages in packages/core/src/oauth/page.ts.
export const Logo = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-wordmark"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 268 42"
      role="img"
      aria-label="Bioinformática.org"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <text
        x="0"
        y="30"
        textLength="268"
        lengthAdjust="spacingAndGlyphs"
        font-family="var(--font-family-sans, ui-sans-serif, system-ui, sans-serif)"
        font-size="28"
        font-weight="600"
        letter-spacing="-0.02em"
        fill="var(--icon-strong-base)"
      >
        {"Bioinformática"}
        <tspan fill="var(--icon-base)">.org</tspan>
      </text>
    </svg>
  )
}
