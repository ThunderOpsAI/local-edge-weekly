import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(2).max(120),
  plan: z.enum(["trial", "solo", "edge"]).default("trial"),
  industry: z.string().min(2).max(40),
  location: z.string().min(2).max(120),
  primaryUrl: z.string().url(),
  competitorUrls: z.array(z.string().url()).max(5),
});

export const updateProjectSchema = z.object({
  name: z.string().min(2).max(120),
  industry: z.string().min(2).max(40),
  location: z.string().min(2).max(120),
});

export const createTargetSchema = z.object({
  url: z.string().url(),
  role: z.enum(["primary", "competitor"]).default("competitor"),
});

export const triggerRunSchema = z.object({
  projectId: z.string().min(1),
  triggeredBy: z.string().optional(),
});

export const approveReportSchema = z.object({
  status: z.literal("approved").default("approved"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateTargetInput = z.infer<typeof createTargetSchema>;
export type TriggerRunInput = z.infer<typeof triggerRunSchema>;
export type ApproveReportInput = z.infer<typeof approveReportSchema>;
