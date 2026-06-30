import Image from "next/image";
import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold">
      <Image
        src="/logo-mark.png"
        alt="What Hooks"
        width={28}
        height={28}
        className="rounded-lg"
        priority
      />
      <span>whathooks</span>
    </Link>
  );
}
