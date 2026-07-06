'use client';

import { useMemo, useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import type { Project } from '@/lib/types';
import ProjectCard from './ProjectCard';
import { cn, EASE } from '@/lib/utils';

export default function ProjectsExplorer({ projects }: { projects: Project[] }) {
  const [filter, setFilter] = useState<string | null>(null);
  const reduced = useReducedMotion();

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);
  }, [projects]);

  const visible = filter ? projects.filter((p) => p.tags.includes(filter)) : projects;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter projects by tag">
        <button
          onClick={() => setFilter(null)}
          className={cn('pill transition-colors', !filter && 'pill-accent')}
        >
          All
        </button>
        {tags.map((tag) => (
          <button
            key={tag}
            onClick={() => setFilter(filter === tag ? null : tag)}
            className={cn('pill transition-colors hover:text-ink', filter === tag && 'pill-accent')}
          >
            {tag}
          </button>
        ))}
      </div>

      <LayoutGroup>
        <motion.div layout={!reduced} className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
          {visible.map((project) => (
            <motion.div
              key={project.slug}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, ease: EASE }}
              className={cn(project.featured && 'md:col-span-2')}
            >
              <ProjectCard project={project} wide={project.featured} />
            </motion.div>
          ))}
        </motion.div>
      </LayoutGroup>

      {visible.length === 0 && (
        <p className="body-lg mt-12 text-center">No projects match that filter.</p>
      )}
    </div>
  );
}
