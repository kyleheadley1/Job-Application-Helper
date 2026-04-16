import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/job_agent_mvp",
  mongoDbName: process.env.MONGO_DB_NAME ?? "job_agent_mvp",
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-5-mini",
};
