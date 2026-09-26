import { motion, useReducedMotion } from 'framer-motion';

import { AuroraBackground, VALUE_PROPS } from '@/components/layout/SiteHeader';
import { ApiStatusCard } from '@/components/system/ApiStatusCard';

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, delay: index * 0.08, ease: 'easeOut' as const },
  }),
};

export function HomePage() {
  const prefersReducedMotion = useReducedMotion();
  const initial = prefersReducedMotion ? false : 'hidden';

  return (
    <div className="relative">
      <AuroraBackground />

      <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
        <motion.p
          initial={initial}
          animate="visible"
          custom={0}
          variants={fadeUp}
          className="inline-flex items-center gap-2 rounded-full border border-ink-100/10 bg-ink-100/5 px-3.5 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-ink-300"
        >
          Fast&nbsp;&bull;&nbsp;Secure&nbsp;&bull;&nbsp;Simple
        </motion.p>

        <motion.h1
          initial={initial}
          animate="visible"
          custom={1}
          variants={fadeUp}
          className="mt-7 max-w-3xl text-center text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl"
        >
          <span className="text-gradient">Your media. Your format. Your flow.</span>
        </motion.h1>

        <motion.p
          initial={initial}
          animate="visible"
          custom={2}
          variants={fadeUp}
          className="mt-5 max-w-xl text-center text-base leading-relaxed text-ink-300 sm:text-lg"
        >
          EasyTube processes authorized media into the format you need. Only download content you
          own or have permission to download.
        </motion.p>

        <motion.div
          initial={initial}
          animate="visible"
          custom={3}
          variants={fadeUp}
          className="mt-10 w-full max-w-md"
        >
          <ApiStatusCard />
        </motion.div>

        <motion.ul
          initial={initial}
          animate="visible"
          custom={4}
          variants={fadeUp}
          className="mt-12 grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3"
        >
          {VALUE_PROPS.map(({ icon: Icon, title, copy }) => (
            <li
              key={title}
              className="rounded-card border border-ink-100/10 bg-ink-900/40 p-4 transition-colors duration-200 hover:border-ink-100/20"
            >
              <Icon className="size-5 text-brand-300" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-ink-50">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-400">{copy}</p>
            </li>
          ))}
        </motion.ul>
      </section>
    </div>
  );
}
