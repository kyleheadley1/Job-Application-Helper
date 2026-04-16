import { ZodSchema } from "zod";

export const parseWithSchema = <T>(schema: ZodSchema<T>, value: unknown): T => schema.parse(value);
