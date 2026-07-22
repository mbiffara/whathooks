import { useTranslations } from "next-intl";
import Image from "next/image";

/**
 * Client logos, rendered as uniform white marks on the dark background
 * (brightness-0 + invert flattens any color; 141.jpg has a white
 * background, so it gets invert + screen blending instead). Served
 * unoptimized — SVGs are blocked by the next/image optimizer.
 */
const BRANDS = [
  {
    name: "Ree Creativos",
    src: "/brands/ree-creativos.png",
    w: 2028,
    h: 687,
    cls: "h-7 w-auto opacity-70 logo-flat",
  },
  {
    name: "Logical Minds",
    src: "/brands/logical-minds.svg",
    w: 1200,
    h: 230,
    cls: "h-5 w-auto opacity-70 logo-flat",
  },
  {
    name: "Tecabot",
    src: "/brands/tecabot.png",
    w: 150,
    h: 36,
    cls: "h-5 w-auto opacity-70 logo-flat",
  },
  {
    name: "SomosFin",
    src: "/brands/somosfin.svg",
    w: 5074,
    h: 677,
    cls: "h-4 w-auto opacity-70 logo-flat",
  },
  {
    name: "Timeless Private Club",
    src: "/brands/timeless.png",
    w: 377,
    h: 86,
    cls: "h-8 w-auto opacity-70 logo-flat",
  },
  {
    name: "creeadores",
    src: "/brands/creeadores.svg",
    w: 840,
    h: 120,
    cls: "h-5 w-auto opacity-70 logo-flat",
  },
  {
    name: "141 Distribución y Transporte",
    src: "/brands/141.jpg",
    w: 500,
    h: 263,
    cls: "h-9 w-auto opacity-80 logo-boxed",
  },
];

export function BrandStrip() {
  const t = useTranslations("brands");
  return (
    <section className="mx-auto max-w-6xl px-6 pb-4 pt-2">
      <p className="text-center text-xs uppercase tracking-wider text-[var(--color-muted)]">
        {t("trustedBy")}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
        {BRANDS.map((brand) => (
          <Image
            key={brand.name}
            src={brand.src}
            alt={brand.name}
            width={brand.w}
            height={brand.h}
            className={brand.cls}
            unoptimized
          />
        ))}
      </div>
    </section>
  );
}
