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

export function card(title: string): HTMLElement {
  const node = el("div", "card border border-base-300 bg-base-100 shadow-sm");
  const body = el("div", "card-body p-3");
  body.append(el("h3", "card-title text-base", title));
  node.append(body);
  return node;
}

export function cardBody(node: HTMLElement): HTMLElement {
  return node.querySelector(".card-body") as HTMLElement;
}

export function textInput(label: string, value: string, onInput: (value: string) => void): HTMLElement {
  const wrap = el("div", "mb-3 form-control");
  wrap.append(el("label", "label", undefined, [el("span", "label-text", label)]));
  const input = document.createElement("input");
  input.type = "text";
  input.className = "input input-bordered w-full";
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
  wrap.append(input);
  return wrap;
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

export function textAreaInput(
  label: string,
  value: string,
  onInput: (value: string) => void,
  rows = 4,
): HTMLElement {
  const wrap = el("div", "mb-3 form-control");
  wrap.append(el("label", "label", undefined, [el("span", "label-text", label)]));
  const input = document.createElement("textarea");
  input.className = "textarea textarea-bordered w-full";
  input.rows = rows;
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
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
