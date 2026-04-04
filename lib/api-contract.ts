import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(2).max(120),
  plan: z.enum(["trial", "solo", "edge"]).default("trial"),
  industry: z.string().min(2).max(40),
  location: z.string().min(2).max(120),
  primaryUrl: z.string().url(),
  competitorUrls: z.array(z.string().url()).max(5),
});

export const triggerRunSchema = z.object({
  projectId: z.string().min(1),
  triggeredBy: z.string().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type TriggerRunInput = z.infer<typeof triggerRunSchema>;
