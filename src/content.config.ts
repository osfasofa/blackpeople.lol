import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';

/**
 * One markdown file per song, in src/content/posts/.
 * The filename (minus .md) becomes the slug, which is also the giscus
 * comment thread key — so renaming a file orphans its comments.
 */
const posts = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
	schema: z.object({
		title: z.string(),
		youtube: z.string(),
		date: z.coerce.date(),
		blurb: z.string().optional(),
	}),
});

export const collections = { posts };
