import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';

/**
 * One markdown file per song, in src/content/posts/.
 * The filename (minus .md) becomes the slug, which is also the giscus
 * comment thread key — so renaming a file orphans its comments.
 *
 * Only `youtube` is required. A file containing nothing but a video ID is a
 * valid post: no title renders, no blurb renders, and it sorts to the top.
 *
 * `date` accepts a plain date or a date and time. Prefer including an offset
 * (2026-08-09T14:30:00-04:00) — a bare time is read as UTC by the YAML parser,
 * which can shift a post across a day boundary in your local timezone.
 */
const posts = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
	schema: z.object({
		youtube: z.string(),
		title: z.string().optional(),
		date: z.coerce.date().optional(),
		blurb: z.string().optional(),
	}),
});

export const collections = { posts };
