import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasServerKey: Boolean(process.env.GROQ_API_KEY?.trim()),
    model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b",
  });
}
