declare module "lucide/dist/esm/createElement.mjs" {
  export default function createElement(
    iconNode: readonly unknown[],
    attributes?: Readonly<Record<string, string | number>>,
  ): SVGElement;
}

declare module "lucide/dist/esm/icons/*.mjs" {
  const iconNode: readonly unknown[];
  export default iconNode;
}
