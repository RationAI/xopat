export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
  children?: HTMLElement[],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (children?.length) children.forEach((child) => node.append(child));
  return node;
}

export function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = text;
  node.addEventListener("click", onClick);
  return node;
}

/**
 * DaisyUI tab button with a single-line, ellipsized label. `.tab` has a fixed
 * height, so a long title would wrap and overflow onto its neighbours; the
 * ellipsis needs an inner span because text-overflow does not apply to flex
 * containers. The full title stays available as a tooltip.
 */
export function tabButton(text: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const node = button("", "tab whitespace-nowrap" + (active ? " tab-active" : ""), onClick);
  const label = el("span", "truncate", text);
  label.style.maxWidth = "11rem";
  node.title = text;
  node.append(label);
  return node;
}

/**
 * Horizontal, scrollable tab strip. Page titles are authored prose ("Slide 1 ·
 * Region A — Gland Architecture"), so a wrapping `flex-wrap` row either eats the
 * whole panel or ellipsizes every tab into uselessness. One scrolling line
 * instead: tabs keep their natural width (no shrink) and the strip scrolls, with
 * the active tab centred so the respondent always sees where they are.
 *
 * Scroll position is set directly on the strip (never `scrollIntoView`, which
 * would also scroll the surrounding panel/viewport).
 */
export function tabStrip(
  items: Array<{ label: string; active: boolean; onClick: () => void }>,
  className = "",
): HTMLElement {
  const strip = el("div", `tabs tabs-boxed flex-nowrap overflow-x-auto overflow-y-hidden ${className}`.trim());
  let activeNode: HTMLElement | undefined;
  items.forEach((item) => {
    const node = tabButton(item.label, item.active, item.onClick);
    node.classList.add("flex-none");
    if (item.active) activeNode = node;
    strip.append(node);
  });
  if (activeNode) {
    const centerActive = () => {
      const target = activeNode!.offsetLeft - (strip.clientWidth - activeNode!.offsetWidth) / 2;
      strip.scrollLeft = Math.max(0, target);
    };
    // Offsets are only real once laid out; the strip is scrolled by its caller's
    // append, so defer one frame.
    requestAnimationFrame(centerActive);
  }
  return strip;
}

export function numberInput(label: string, value: number, onInput: (value: number) => void): HTMLElement {
  const wrap = el("div", "mb-3 form-control");
  wrap.append(el("label", "label", undefined, [el("span", "label-text", label)]));
  const input = document.createElement("input");
  input.type = "number";
  input.className = "input input-bordered w-full";
  input.value = String(value ?? 0);
  input.addEventListener("input", () => onInput(Number(input.value || 0)));
  wrap.append(input);
  return wrap;
}

export function toggleInput(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const wrap = el("label", "mb-3 label cursor-pointer justify-start gap-3");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "toggle";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  wrap.append(input, el("span", "label-text", label));
  return wrap;
}
