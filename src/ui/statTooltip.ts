export interface StatHistorySample {
  label: string;
  value: number;
}

export interface StatFactor {
  label: string;
  detail: string;
  tone?: "positive" | "negative" | "neutral";
}

export interface StatInsight {
  title: string;
  current: string;
  description: string;
  history: readonly StatHistorySample[];
  historyLabel?: string;
  factors: readonly StatFactor[];
}

type StatResolver = (target: HTMLElement) => StatInsight | null;

export function installStatTooltips(
  tooltip: HTMLElement,
  resolve: StatResolver,
): void {
  let activeTarget: HTMLElement | null = null;

  const show = (target: HTMLElement, x?: number, y?: number): void => {
    const insight = resolve(target);
    if (!insight) return;
    activeTarget = target;
    tooltip.innerHTML = renderInsight(insight);
    tooltip.hidden = false;
    positionTooltip(tooltip, target, x, y);
  };

  const hide = (): void => {
    activeTarget = null;
    tooltip.hidden = true;
  };

  document.addEventListener("pointerover", (event) => {
    const target = statTarget(event.target);
    if (!target || target === activeTarget) return;
    show(target, event.clientX, event.clientY);
  });
  document.addEventListener("pointermove", (event) => {
    if (activeTarget) positionTooltip(tooltip, activeTarget, event.clientX, event.clientY);
  });
  document.addEventListener("pointerout", (event) => {
    if (!activeTarget) return;
    const nextTarget = statTarget(event.relatedTarget);
    if (nextTarget !== activeTarget) hide();
  });
  document.addEventListener("focusin", (event) => {
    const target = statTarget(event.target);
    if (target) show(target);
  });
  document.addEventListener("focusout", (event) => {
    if (statTarget(event.relatedTarget) !== activeTarget) hide();
  });
  window.addEventListener("resize", () => {
    if (activeTarget) positionTooltip(tooltip, activeTarget);
  });
  window.addEventListener("blur", hide);
}

function renderInsight(insight: Readonly<StatInsight>): string {
  const history = insight.history.filter((sample) => Number.isFinite(sample.value));
  const values = history.map((sample) => sample.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(0.0001, maximum - minimum);
  const bars = history.map((sample) => {
    const height = history.length === 1 ? 58 : 18 + (sample.value - minimum) / range * 82;
    return `<i style="height:${height.toFixed(1)}%" title="${escapeHtml(sample.label)}"></i>`;
  }).join("");
  const first = history[0];
  const last = history.at(-1);
  const change = first && last ? last.value - first.value : 0;
  const direction = Math.abs(change) < 0.0001 ? "No change" : change > 0 ? "Rising" : "Falling";
  const historyMarkup = history.length > 0
    ? `<section class="stat-tooltip-history">
        <header><b>${escapeHtml(insight.historyLabel ?? "Recent history")}</b><span data-trend="${change > 0 ? "up" : change < 0 ? "down" : "flat"}">${direction}</span></header>
        <div class="stat-sparkline" aria-hidden="true">${bars}</div>
        <footer><span>${escapeHtml(first?.label ?? "")}</span><span>${escapeHtml(last?.label ?? "")}</span></footer>
      </section>`
    : `<p class="stat-tooltip-no-history">History begins when the simulation advances.</p>`;
  return `<header class="stat-tooltip-heading"><span>${escapeHtml(insight.title)}</span><strong>${escapeHtml(insight.current)}</strong></header>
    <p>${escapeHtml(insight.description)}</p>
    ${historyMarkup}
    <section class="stat-tooltip-factors">
      <b>What affects it</b>
      <ul>${insight.factors.map((factor) => `<li data-tone="${factor.tone ?? "neutral"}"><span>${escapeHtml(factor.label)}</span><small>${escapeHtml(factor.detail)}</small></li>`).join("")}</ul>
    </section>`;
}

function positionTooltip(
  tooltip: HTMLElement,
  target: HTMLElement,
  pointerX?: number,
  pointerY?: number,
): void {
  const targetBounds = target.getBoundingClientRect();
  const bounds = tooltip.getBoundingClientRect();
  const preferredX = pointerX ?? targetBounds.right;
  const preferredY = pointerY ?? targetBounds.top;
  const left = Math.max(8, Math.min(window.innerWidth - bounds.width - 8, preferredX + 14));
  const above = preferredY - bounds.height - 12;
  const top = above >= 8
    ? above
    : Math.max(8, Math.min(window.innerHeight - bounds.height - 8, preferredY + 14));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function statTarget(value: EventTarget | null): HTMLElement | null {
  return value instanceof Element
    ? value.closest<HTMLElement>("[data-stat]")
    : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}
