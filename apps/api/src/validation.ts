import { z } from "zod";

export const ProfileInput = z
  .object({
    displayName: z.string().trim().min(2).max(40),
    age: z.number().int().min(18, "Users must be 18 or older").max(100),
    bio: z.string().trim().max(500).default(""),
    interests: z.array(z.string().trim().min(1).max(30)).max(15).default([]),
    lookingFor: z.enum(["relationship", "friendship", "casual"]),
    ageMin: z.number().int().min(18).max(100),
    ageMax: z.number().int().min(18).max(100),
  })
  .refine((p) => p.ageMin <= p.ageMax, {
    message: "ageMin must be less than or equal to ageMax",
    path: ["ageMin"],
  });

export type ProfileInput = z.infer<typeof ProfileInput>;

export const MessageInput = z.object({
  matchId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});
